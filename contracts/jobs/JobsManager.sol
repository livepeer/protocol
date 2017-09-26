pragma solidity ^0.4.13;

import "../ManagerProxyTarget.sol";
import "./IJobsManager.sol";
import "./libraries/JobLib.sol";
import "../token/ILivepeerToken.sol";
import "../token/IMinter.sol";
import "../bonding/IBondingManager.sol";
import "../verification/IVerifiable.sol";
import "../verification/IVerifier.sol";

import "zeppelin-solidity/contracts/math/SafeMath.sol";
import "zeppelin-solidity/contracts/ECRecovery.sol";
import "zeppelin-solidity/contracts/MerkleProof.sol";


contract JobsManager is ManagerProxyTarget, IVerifiable, IJobsManager {
    using SafeMath for uint256;

    // % of segments to be verified. 1 / verificationRate == % to be verified
    uint64 public verificationRate;

    // % of verifications you can fail before being slashed
    uint64 public verificationFailureThreshold;

    // Time between when endJob() is called for a job and when the job is considered inactive. Denominated in blocks
    uint256 public jobEndingPeriod;

    // Time after a transcoder calls claimWork() that it has to complete verification of claimed work
    uint256 public verificationPeriod;

    // Time after a claim's verification period during which anyone can slash the transcoder for missing a required verification
    uint256 public slashingPeriod;

    // % of stake slashed for failed verification
    uint64 public failedVerificationSlashAmount;

    // % of stake slashed for missed verification
    uint64 public missedVerificationSlashAmount;

    // % of of slashed amount awarded to finder
    uint64 public finderFee;

    // Mapping broadcaster => deposited funds for jobs
    mapping (address => uint256) public broadcasterDeposits;

    // Represents a transcode job
    struct Job {
        uint256 jobId;                        // Unique identifer for job
        string streamId;                      // Unique identifier for stream.
        string transcodingOptions;            // Options used for transcoding
        uint256 maxPricePerSegment;           // Max price (in LPT base units) per segment of a stream
        address broadcasterAddress;           // Address of broadcaster that requestes a transcoding job
        address transcoderAddress;            // Address of transcoder selected for the job
        uint256 endBlock;                     // Block at which the job is ended and considered inactive
        Claim[] claims;                       // Claims submitted for this job
        uint256 escrow;                       // Claim fees before verification and slashing periods are complete
    }

    // States of a job
    enum JobStatus { Inactive, Active }

    // Represents a transcode claim
    struct Claim {
        uint256 claimId;                                   // Unique identifier for claim
        uint256[2] segmentRange;                           // Range of segments claimed
        bytes32 claimRoot;                                 // Merkle root of segment transcode proof data
        uint256 claimBlock;                                // Block number that claim was submitted
        uint256 endVerificationBlock;                      // End of verification period for this claim
        uint256 endSlashingBlock;                          // End of slashing period for this claim
        uint256 transcoderTotalStake;                      // Transcoder's total stake at the time of claim
        mapping (uint256 => bool) segmentVerifications;    // Mapping segment number => whether segment was submitted for verification
        ClaimStatus status;                                // Status of claim (pending, slashed, complete)
    }

    // States of a transcode claim
    enum ClaimStatus { Pending, Slashed, Complete }

    // Transcode jobs
    mapping (uint256 => Job) public jobs;
    // Number of jobs created. Also used for sequential identifiers
    uint256 public numJobs;

    // Check if sender is Verifier contract
    modifier onlyVerifier() {
        require(IVerifier(msg.sender) == verifier());
        _;
    }

    // Check if job exists
    modifier jobExists(uint256 _jobId) {
        require(_jobId < numJobs);
        _;
    }

    // Check if sender provided enough payment for verification
    modifier sufficientPayment() {
        require(msg.value >= verifier().getPrice());
        _;
    }

    // Events
    event NewJob(address indexed transcoder, address indexed broadcaster, uint256 jobId, string streamId, string transcodingOptions);
    event NewClaim(address indexed transcoder, uint256 indexed jobId, uint256 claimId);
    event ReceivedVerification(uint256 indexed jobId, uint256 indexed claimId, uint256 segmentNumber, bool result);

    function JobsManager(address _controller) Manager(_controller) {}

    function initialize(
        uint64 _verificationRate,
        uint256 _jobEndingPeriod,
        uint256 _verificationPeriod,
        uint256 _slashingPeriod,
        uint64 _failedVerificationSlashAmount,
        uint64 _missedVerificationSlashAmount,
        uint64 _finderFee
    )
        external
        beforeInitialization
        returns (bool)
    {
        finishInitialization();

        verificationRate = _verificationRate;
        jobEndingPeriod = _jobEndingPeriod;
        verificationPeriod = _verificationPeriod;
        slashingPeriod = _slashingPeriod;
        failedVerificationSlashAmount = _failedVerificationSlashAmount;
        missedVerificationSlashAmount = _missedVerificationSlashAmount;
        finderFee = _finderFee;
    }

    /*
     * @dev Deposit funds for jobs
     * @param _amount Amount to deposit
     */
    function deposit(uint256 _amount) external afterInitialization whenSystemNotPaused returns (bool) {
        broadcasterDeposits[msg.sender] = broadcasterDeposits[msg.sender].add(_amount);
        // Transfer tokens for deposit to Minter. Sender needs to approve amount first
        livepeerToken().transferFrom(msg.sender, minter(), _amount);

        return true;
    }

    /*
     * @dev Withdraw deposited funds
     * FIXME: Attacker can withdraw funds before transcoder has a chance to claim them
     */
    function withdraw() external afterInitialization whenSystemNotPaused returns (bool) {
        uint256 amount = broadcasterDeposits[msg.sender];
        broadcasterDeposits[msg.sender] = 0;
        minter().transferTokens(msg.sender, amount);

        return true;
    }

    /*
     * @dev Submit a transcoding job
     * @param _streamId Unique stream identifier
     * @param _transcodingOptions Output bitrates, formats, encodings
     * @param _maxPricePerSegment Max price (in LPT base units) to pay for transcoding a segment of a stream
     */
    function job(string _streamId, string _transcodingOptions, uint256 _maxPricePerSegment)
        external
        afterInitialization
        whenSystemNotPaused
        returns (bool)
    {
        address electedTranscoder = bondingManager().electActiveTranscoder(_maxPricePerSegment);
        /* There must be an elected transcoder */
        require(electedTranscoder != address(0));

        Job storage job = jobs[numJobs];
        job.jobId = numJobs;
        job.streamId = _streamId;
        job.transcodingOptions = _transcodingOptions;
        job.maxPricePerSegment = _maxPricePerSegment;
        job.broadcasterAddress = msg.sender;
        job.transcoderAddress = electedTranscoder;

        NewJob(electedTranscoder, msg.sender, numJobs, _streamId, _transcodingOptions);

        // Increment number of created jobs
        numJobs = numJobs.add(1);

        return true;
    }

    /*
     * @dev End a job. Can be called by either a broadcaster or transcoder of a job
     * @param _jobId Job identifier
     */
    function endJob(uint256 _jobId) external afterInitialization whenSystemNotPaused returns (bool) {
        Job storage job = jobs[_jobId];

        // Job must not already have an end block
        require(job.endBlock == 0);
        // Sender must be the job's broadcaster or elected transcoder
        require(job.broadcasterAddress == msg.sender || job.transcoderAddress == msg.sender);

        // Set end block for job
        job.endBlock = block.number.add(jobEndingPeriod);
    }

    /*
     * @dev Submit claim for a range of segments
     * @param _jobId Job identifier
     * @param _segmentRange Range of claimed segments
     * @param _claimRoot Merkle root of transcoded segment proof data for claimed segments
     */
    function claimWork(uint256 _jobId, uint256[2] _segmentRange, bytes32 _claimRoot)
        external
        afterInitialization
        whenSystemNotPaused
        jobExists(_jobId)
        returns (bool)
    {
        Job storage job = jobs[_jobId];

        // Job must be active
        require(jobStatus(_jobId) == JobStatus.Active);
        // Sender must be elected transcoder
        require(job.transcoderAddress == msg.sender);
        // Segment range must be valid
        require(_segmentRange[1] >= _segmentRange[0]);

        // Move fees from broadcaster deposit to escrow
        uint256 fees = _segmentRange[1].sub(_segmentRange[0]).add(1).mul(job.maxPricePerSegment);
        broadcasterDeposits[job.broadcasterAddress] = broadcasterDeposits[job.broadcasterAddress].sub(fees);
        job.escrow = job.escrow.add(fees);

        uint256 transcoderTotalStake = bondingManager().transcoderTotalStake(msg.sender);
        uint256 endVerificationBlock = block.number.add(verificationPeriod);
        uint256 endSlashingBlock = endVerificationBlock.add(slashingPeriod);

        job.claims.push(
            Claim({
                claimId: job.claims.length,
                segmentRange: _segmentRange,
                claimRoot: _claimRoot,
                claimBlock: block.number,
                transcoderTotalStake: transcoderTotalStake,
                endVerificationBlock: endVerificationBlock,
                endSlashingBlock: endSlashingBlock,
                status: ClaimStatus.Pending
           })
        );

        NewClaim(job.transcoderAddress, _jobId, job.claims.length - 1);

        return true;
    }

    /*
     * @dev Submit transcode receipt and invoke transcoding verification
     * @param _jobId Job identifier
     * @param _segmentNumber Segment sequence number in stream
     * @param _dataHash Content-addressed storage hash of segment data
     * @param _transcodedDataHash Hash of transcoded segment data
     * @param _broadcasterSig Broadcaster's signature over segment hash
     * @param _proof Merkle proof for transcode receipt
     */
    function verify(
        uint256 _jobId,
        uint256 _claimId,
        uint256 _segmentNumber,
        string _dataStorageHash,
        bytes32 _dataHash,
        bytes32 _transcodedDataHash,
        bytes _broadcasterSig,
        bytes _proof
    )
        external
        payable
        afterInitialization
        whenSystemNotPaused
        sufficientPayment
        returns (bool)
    {
        require(_jobId < numJobs);

        Job storage job = jobs[_jobId];
        Claim storage claim = job.claims[_claimId];

        // Job must be active
        require(jobStatus(_jobId) == JobStatus.Active);
        // Sender must be elected transcoder
        require(job.transcoderAddress == msg.sender);

        // Segment must be eligible for verification
        require(JobLib.shouldVerifySegment(_segmentNumber, claim.segmentRange, claim.claimBlock, verificationRate));
        // Segment must be signed by broadcaster
        require(JobLib.validateBroadcasterSig(job.streamId, _segmentNumber, _dataHash, _broadcasterSig, job.broadcasterAddress));
        // Receipt must be valid
        require(JobLib.validateReceipt(job.streamId, _segmentNumber, _dataHash, _transcodedDataHash, _broadcasterSig, _proof, claim.claimRoot));

        // Mark segment as submitted for verification
        claim.segmentVerifications[_segmentNumber] = true;

        // Invoke transcoding verification. This is async and will result in a callback to receiveVerification() which is implemented by this contract
        invokeVerification(_jobId, _claimId, _segmentNumber, _dataStorageHash, _transcodedDataHash);

        return true;
    }

    function invokeVerification(
        uint256 _jobId,
        uint256 _claimId,
        uint256 _segmentNumber,
        string _dataStorageHash,
        bytes32 _transcodedDataHash
    )
        internal
        returns (bool)
    {
        IVerifier verifierContract = verifier();

        uint256 price = verifierContract.getPrice();

        // Send payment to verifier if price is greater than zero
        if (price > 0) {
            return verifier().verify(_jobId, _claimId, _segmentNumber, jobs[_jobId].transcodingOptions, _dataStorageHash, _transcodedDataHash);
        } else {
            return verifier().verify.value(price)(_jobId, _claimId, _segmentNumber, jobs[_jobId].transcodingOptions, _dataStorageHash, _transcodedDataHash);
        }
    }

    /*
     * @dev Callback function that receives the results of transcoding verification
     * @param _jobId Job identifier
     * @param _segmentNumber Segment being verified for job
     * @param _result Boolean result of whether verification succeeded or not
     */
    function receiveVerification(uint256 _jobId, uint256 _claimId, uint256 _segmentNumber, bool _result)
        external
        afterInitialization
        whenSystemNotPaused
        onlyVerifier
        returns (bool)
    {
        if (!_result) {
            refundBroadcaster(_jobId, _claimId);
            // Protocol slashes transcoder for failing verification (no finder)
            bondingManager().slashTranscoder(jobs[_jobId].transcoderAddress, address(0), failedVerificationSlashAmount, 0);
        }

        ReceivedVerification(_jobId, _claimId, _segmentNumber, _result);

        return true;
    }

    /*
     * @dev Distribute fees for multiple claims
     * @param _jobId Job identifier
     * @param _claimId Claim identifier
     */
    function batchDistributeFees(uint256 _jobId, uint256[] _claimIds)
        external
        afterInitialization
        whenSystemNotPaused
        returns (bool)
    {
        for (uint256 i = 0; i < _claimIds.length; i++) {
            distributeFees(_jobId, _claimIds[i]);
        }

        return true;
    }

    /*
     * @dev Slash transcoder for missing verification
     * @param _jobId Job identifier
     * @param _claimId Claim identifier
     * @param _segmentNumber Segment that was not verified
     */
    function missedVerificationSlash(uint256 _jobId, uint256 _claimId, uint256 _segmentNumber)
        external
        afterInitialization
        whenSystemNotPaused
        jobExists(_jobId)
        returns (bool)
    {
        Job storage job = jobs[_jobId];
        Claim storage claim = job.claims[_claimId];

        // Must be after verification period
        require(block.number > claim.endVerificationBlock);
        // Must be before end of slashing period
        require(block.number <= claim.endSlashingBlock);
        // Claim must be pending
        require(claim.status == ClaimStatus.Pending);
        // Segment must be eligible for verification
        require(JobLib.shouldVerifySegment(_segmentNumber, claim.segmentRange, claim.claimBlock, verificationRate));
        // Transcoder must have missed verification for the segment
        require(!claim.segmentVerifications[_segmentNumber]);

        refundBroadcaster(_jobId, _claimId);

        // Slash transcoder and provide finder params
        bondingManager().slashTranscoder(job.transcoderAddress, msg.sender, missedVerificationSlashAmount, finderFee);

        // Set claim as slashed
        claim.status = ClaimStatus.Slashed;

        return true;
    }

    /*
     * @dev Distribute fees for a particular claim
     * @param _jobId Job identifier
     * @param _claimId Claim identifier
     */
    function distributeFees(uint256 _jobId, uint256 _claimId)
        public
        afterInitialization
        whenSystemNotPaused
        jobExists(_jobId)
        returns (bool)
    {
        Job storage job = jobs[_jobId];
        Claim storage claim = job.claims[_claimId];

        // Sender must be elected transcoder for job
        require(job.transcoderAddress == msg.sender);
        // Claim must not be complete
        require(claim.status == ClaimStatus.Pending);
        // Slashing period must be over for claim
        require(claim.endSlashingBlock < block.number);

        uint256 fees = claim.segmentRange[1].sub(claim.segmentRange[0]).add(1).mul(job.maxPricePerSegment);
        // Deduct fees from escrow
        job.escrow = job.escrow.sub(fees);
        // Add fees to transcoder's fee pool
        bondingManager().updateTranscoderFeePool(msg.sender, fees, claim.claimBlock, claim.transcoderTotalStake);

        // Set claim as complete
        claim.status = ClaimStatus.Complete;

        return true;
    }

    /*
     * @dev Compute status of job
     * @param _jobId Job identifier
     */
    function jobStatus(uint256 _jobId) public constant returns (JobStatus) {
        if (jobs[_jobId].endBlock > 0 && jobs[_jobId].endBlock <= block.number) {
            // A job is inactive if its end block is set and the current block is greater than or equal to the job's end block
            return JobStatus.Inactive;
        } else {
            // A job is active if the current block is less than the job's end block
            return JobStatus.Active;
        }
    }

    // Job getters

    function getJobStreamId(uint256 _jobId) public constant returns (string) {
        return jobs[_jobId].streamId;
    }

    function getJobTranscodingOptions(uint256 _jobId) public constant returns (string) {
        return jobs[_jobId].transcodingOptions;
    }

    function getJobMaxPricePerSegment(uint256 _jobId) public constant returns (uint256) {
        return jobs[_jobId].maxPricePerSegment;
    }

    function getJobBroadcasterAddress(uint256 _jobId) public constant returns (address) {
        return jobs[_jobId].broadcasterAddress;
    }

    function getJobTranscoderAddress(uint256 _jobId) public constant returns (address) {
        return jobs[_jobId].transcoderAddress;
    }

    function getJobEndBlock(uint256 _jobId) public constant returns (uint256) {
        return jobs[_jobId].endBlock;
    }

    function getJobEscrow(uint256 _jobId) public constant returns (uint256) {
        return jobs[_jobId].escrow;
    }

    function getJobTotalClaims(uint256 _jobId) public constant returns (uint256) {
        return jobs[_jobId].claims.length;
    }

    // Claim getters

    function getClaimStartSegment(uint256 _jobId, uint256 _claimId) public constant returns (uint256) {
        return jobs[_jobId].claims[_claimId].segmentRange[0];
    }

    function getClaimEndSegment(uint256 _jobId, uint256 _claimId) public constant returns (uint256) {
        return jobs[_jobId].claims[_claimId].segmentRange[1];
    }

    function getClaimRoot(uint256 _jobId, uint256 _claimId) public constant returns (bytes32) {
        return jobs[_jobId].claims[_claimId].claimRoot;
    }

    function getClaimBlock(uint256 _jobId, uint256 _claimId) public constant returns (uint256) {
        return jobs[_jobId].claims[_claimId].claimBlock;
    }

    function getClaimEndVerificationBlock(uint256 _jobId, uint256 _claimId) public constant returns (uint256) {
        return jobs[_jobId].claims[_claimId].endVerificationBlock;
    }

    function getClaimEndSlashingBlock(uint256 _jobId, uint256 _claimId) public constant returns (uint256) {
        return jobs[_jobId].claims[_claimId].endSlashingBlock;
    }

    function getClaimTranscoderTotalStake(uint256 _jobId, uint256 _claimId) public constant returns (uint256) {
        return jobs[_jobId].claims[_claimId].transcoderTotalStake;
    }

    function getClaimStatus(uint256 _jobId, uint256 _claimId) public constant returns (ClaimStatus) {
        return jobs[_jobId].claims[_claimId].status;
    }

    /*
     * @dev Refund broadcaster for a claim
     * @param _jobId Job identifier
     * @param _claimId Claim identifier
     */
    function refundBroadcaster(uint256 _jobId, uint256 _claimId) internal returns (bool) {
        Job storage job = jobs[_jobId];
        Claim storage claim = job.claims[_claimId];

        // Return escrowed fees for claim
        uint256 fees = claim.segmentRange[1].sub(claim.segmentRange[0]).add(1).mul(job.maxPricePerSegment);
        job.escrow = job.escrow.sub(fees);
        broadcasterDeposits[job.broadcasterAddress] = broadcasterDeposits[job.broadcasterAddress].add(fees);

        return true;
    }

    /*
     * @dev Returns LivepeerToken
     */
    function livepeerToken() internal constant returns (ILivepeerToken) {
        return ILivepeerToken(controller.getContract(keccak256("LivepeerToken")));
    }

    /*
     * @dev Returns Minter
     */
    function minter() internal constant returns (IMinter) {
        return IMinter(controller.getContract(keccak256("Minter")));
    }

    /*
     * @dev Returns BondingManager
     */
    function bondingManager() internal constant returns (IBondingManager) {
        return IBondingManager(controller.getContract(keccak256("BondingManager")));
    }

    /*
     * @dev Returns Verifier
     */
    function verifier() internal constant returns (IVerifier) {
        return IVerifier(controller.getContract(keccak256("Verifier")));
    }
}
