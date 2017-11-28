pragma solidity ^0.4.17;

import "../ManagerProxyTarget.sol";
import "./IJobsManager.sol";
import "./libraries/JobLib.sol";
import "../token/ILivepeerToken.sol";
import "../token/IMinter.sol";
import "../bonding/IBondingManager.sol";
import "../rounds/IRoundsManager.sol";
import "../verification/IVerifiable.sol";
import "../verification/IVerifier.sol";

import "zeppelin-solidity/contracts/math/SafeMath.sol";


contract JobsManager is ManagerProxyTarget, IVerifiable, IJobsManager {
    using SafeMath for uint256;

    // % of segments to be verified. 1 / verificationRate == % to be verified
    uint64 public verificationRate;

    // % of verifications you can fail before being slashed
    uint64 public verificationFailureThreshold;

    // Time after a transcoder calls claimWork() that it has to complete verification of claimed work
    uint256 public verificationPeriod;

    // Time after a claim's verification period during which anyone can slash the transcoder for missing a required verification
    uint256 public slashingPeriod;

    // % of stake slashed for failed verification
    uint64 public failedVerificationSlashAmount;

    // % of stake slashed for missed verification
    uint64 public missedVerificationSlashAmount;

    // % of stake slashed for double claiming a segment
    uint64 public doubleClaimSegmentSlashAmount;

    // % of of slashed amount awarded to finder
    uint64 public finderFee;

    struct Broadcaster {
        uint256 deposit;         // Deposited tokens for jobs
        uint256 withdrawBlock;   // Block at which a deposit can be withdrawn
    }

    // Mapping broadcaster address => broadcaster info
    mapping (address => Broadcaster) public broadcasters;

    // Represents a transcode job
    struct Job {
        uint256 jobId;                        // Unique identifer for job
        string streamId;                      // Unique identifier for stream.
        string transcodingOptions;            // Options used for transcoding
        uint256 maxPricePerSegment;           // Max price (in LPT base units) per segment of a stream
        address broadcasterAddress;           // Address of broadcaster that requestes a transcoding job
        address transcoderAddress;            // Address of transcoder selected for the job
        uint256 creationRound;                // Round that a job is created
        uint256 creationBlock;                // Block that a job is created
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
    event NewJob(address indexed broadcaster, uint256 jobId, string streamId, string transcodingOptions, uint256 maxPricePerSegment, uint256 creationBlock);
    event NewClaim(address indexed transcoder, uint256 indexed jobId, uint256 claimId);
    event ReceivedVerification(uint256 indexed jobId, uint256 indexed claimId, uint256 segmentNumber, bool result);

    function JobsManager(address _controller) Manager(_controller) {}

    function initialize(
        uint64 _verificationRate,
        uint256 _verificationPeriod,
        uint256 _slashingPeriod,
        uint64 _failedVerificationSlashAmount,
        uint64 _missedVerificationSlashAmount,
        uint64 _doubleClaimSegmentSlashAmount,
        uint64 _finderFee
    )
        external
        beforeInitialization
        returns (bool)
    {
        finishInitialization();

        verificationRate = _verificationRate;

        // Verification period + slashing period currently cannot be longer than 256 blocks
        // because contracts can only access the last 256 blocks from
        // the current block
        require(_verificationPeriod + _slashingPeriod <= 256);

        verificationPeriod = _verificationPeriod;
        slashingPeriod = _slashingPeriod;
        failedVerificationSlashAmount = _failedVerificationSlashAmount;
        missedVerificationSlashAmount = _missedVerificationSlashAmount;
        doubleClaimSegmentSlashAmount = _doubleClaimSegmentSlashAmount;
        finderFee = _finderFee;
    }

    /*
     * @dev Deposit funds for jobs
     * @param _amount Amount to deposit
     */
    function deposit(uint256 _amount) external afterInitialization whenSystemNotPaused returns (bool) {
        broadcasters[msg.sender].deposit = broadcasters[msg.sender].deposit.add(_amount);
        // Transfer tokens for deposit to Minter. Sender needs to approve amount first
        livepeerToken().transferFrom(msg.sender, minter(), _amount);

        return true;
    }

    /*
     * @dev Withdraw deposited funds
     */
    function withdraw() external afterInitialization whenSystemNotPaused returns (bool) {
        // Can only withdraw at or after the broadcster's withdraw block
        require(broadcasters[msg.sender].withdrawBlock <= block.number);

        uint256 amount = broadcasters[msg.sender].deposit;
        delete broadcasters[msg.sender];
        minter().transferTokens(msg.sender, amount);

        return true;
    }

    /*
     * @dev Submit a transcoding job
     * @param _streamId Unique stream identifier
     * @param _transcodingOptions Output bitrates, formats, encodings
     * @param _maxPricePerSegment Max price (in LPT base units) to pay for transcoding a segment of a stream
     * @param _endBlock Block at which this job becomes inactive
     */
    function job(string _streamId, string _transcodingOptions, uint256 _maxPricePerSegment, uint256 _endBlock)
        external
        afterInitialization
        whenSystemNotPaused
        returns (bool)
    {
        // End block must be in the future
        require(_endBlock > block.number);

        Job storage job = jobs[numJobs];
        job.jobId = numJobs;
        job.streamId = _streamId;
        job.transcodingOptions = _transcodingOptions;
        job.maxPricePerSegment = _maxPricePerSegment;
        job.broadcasterAddress = msg.sender;
        job.creationRound = roundsManager().currentRound();
        job.creationBlock = block.number;
        job.endBlock = _endBlock;

        NewJob(msg.sender, numJobs, _streamId, _transcodingOptions, _maxPricePerSegment, block.number);

        // Increment number of created jobs
        numJobs = numJobs.add(1);

        if (_endBlock > broadcasters[msg.sender].withdrawBlock) {
            // Set new withdraw block if job end block is greater than current
            // broadcaster withdraw block
            broadcasters[msg.sender].withdrawBlock = _endBlock;
        }

        return true;
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

        // Job cannot be inactive
        require(jobStatus(_jobId) != JobStatus.Inactive);
        // Segment range must be valid
        require(_segmentRange[1] >= _segmentRange[0]);

        if (job.transcoderAddress != address(0)) {
            // If transcoder already assigned, check if sender is
            // the assigned transcoder
            require(job.transcoderAddress == msg.sender);
        } else {
            // If transcoder is not already assigned, check if sender
            // should be assigned and that job creation block + 1 has been mined and it has been <= 256 blocks since the job creation block
            require(block.number > job.creationBlock + 1 && block.number <= job.creationBlock + 256 && bondingManager().electActiveTranscoder(job.maxPricePerSegment, job.creationBlock + 1) == msg.sender);
            job.transcoderAddress = msg.sender;
        }

        // Move fees from broadcaster deposit to escrow
        uint256 fees = JobLib.calcFees(_segmentRange[1].sub(_segmentRange[0]).add(1), job.transcodingOptions, job.maxPricePerSegment);
        broadcasters[job.broadcasterAddress].deposit = broadcasters[job.broadcasterAddress].deposit.sub(fees);
        job.escrow = job.escrow.add(fees);

        uint256 endVerificationBlock = block.number.add(verificationPeriod);
        uint256 endSlashingBlock = endVerificationBlock.add(slashingPeriod);

        job.claims.push(
            Claim({
                claimId: job.claims.length,
                segmentRange: _segmentRange,
                claimRoot: _claimRoot,
                claimBlock: block.number,
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
     * @param _dataStorageHash Content-addressed storage hash of segment data
     * @param _dataHashes Hash of segment data and hash of transcoded segment data
     * @param _broadcasterSig Broadcaster's signature over segment hash
     * @param _proof Merkle proof for transcode receipt
     */
    function verify(
        uint256 _jobId,
        uint256 _claimId,
        uint256 _segmentNumber,
        string _dataStorageHash,
        bytes32[2] _dataHashes,
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

        // Job cannot be inactive
        require(jobStatus(_jobId) != JobStatus.Inactive);
        // Sender must be elected transcoder
        require(job.transcoderAddress == msg.sender);

        // Segment must be eligible for verification
        require(JobLib.shouldVerifySegment(_segmentNumber, claim.segmentRange, claim.claimBlock, verificationRate));
        // Segment must be signed by broadcaster
        require(JobLib.validateBroadcasterSig(job.streamId, _segmentNumber, _dataHashes[0], _broadcasterSig, job.broadcasterAddress));
        // Receipt must be valid
        require(JobLib.validateReceipt(job.streamId, _segmentNumber, _dataHashes[0], _dataHashes[1], _broadcasterSig, _proof, claim.claimRoot));

        // Mark segment as submitted for verification
        claim.segmentVerifications[_segmentNumber] = true;

        // Invoke transcoding verification. This is async and will result in a callback to receiveVerification() which is implemented by this contract
        invokeVerification(_jobId, _claimId, _segmentNumber, _dataStorageHash, _dataHashes);

        return true;
    }

    /*
     * @dev Invoke transcoding verification by calling the Verifier contract
     * @param _jobId Job identifier
     * @param _claimId Claim identifier
     * @param _segmentNumber Segment sequence number in stream
     * @param _dataStorageHash Content addressable storage hash of segment data
     * @param _dataHashes Hash of segment data and hash of transcoded segment data
     */
    function invokeVerification(
        uint256 _jobId,
        uint256 _claimId,
        uint256 _segmentNumber,
        string _dataStorageHash,
        bytes32[2] _dataHashes
    )
        internal
        returns (bool)
    {
        IVerifier verifierContract = verifier();

        uint256 price = verifierContract.getPrice();

        // Send payment to verifier if price is greater than zero
        if (price > 0) {
            return verifierContract.verify.value(price)(_jobId, _claimId, _segmentNumber, jobs[_jobId].transcodingOptions, _dataStorageHash, _dataHashes);
        } else {
            return verifierContract.verify(_jobId, _claimId, _segmentNumber, jobs[_jobId].transcodingOptions, _dataStorageHash, _dataHashes);
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
            refundBroadcaster(_jobId);
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

        refundBroadcaster(_jobId);

        // Slash transcoder and provide finder params
        bondingManager().slashTranscoder(job.transcoderAddress, msg.sender, missedVerificationSlashAmount, finderFee);

        // Set claim as slashed
        claim.status = ClaimStatus.Slashed;

        return true;
    }

    /*
     * @dev Slash transcoder for claiming a segment twice
     * @param _jobId Job identifier
     * @param _claimId1 Claim 1 identifier
     * @param _claimId2 Claim 2 identifier
     * @param _segmentNumber Segment that was claimed twice
     */
    function doubleClaimSegmentSlash(
        uint256 _jobId,
        uint256 _claimId1,
        uint256 _claimId2,
        uint256 _segmentNumber
    )
        external
        afterInitialization
        whenSystemNotPaused
        jobExists(_jobId)
        returns (bool)
    {
        Job storage job = jobs[_jobId];
        Claim storage claim1 = job.claims[_claimId1];
        Claim storage claim2 = job.claims[_claimId2];

        // Claims must be pending
        require(claim1.status == ClaimStatus.Pending && claim2.status == ClaimStatus.Pending);
        // Segment must be in claim 1 segment range
        require(_segmentNumber >= claim1.segmentRange[0] && _segmentNumber <= claim1.segmentRange[1]);
        // Segment must be in claim 2 segment range
        require(_segmentNumber >= claim2.segmentRange[0] && _segmentNumber <= claim2.segmentRange[1]);

        // Slash transcoder and provide finder params
        bondingManager().slashTranscoder(job.transcoderAddress, msg.sender, doubleClaimSegmentSlashAmount, finderFee);

        refundBroadcaster(_jobId);

        // Set claim 1 as slashed
        claim1.status = ClaimStatus.Slashed;
        // Set claim 2 as slashed
        claim2.status = ClaimStatus.Slashed;

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

        uint256 fees = JobLib.calcFees(claim.segmentRange[1].sub(claim.segmentRange[0]).add(1), job.transcodingOptions, job.maxPricePerSegment);
        // Deduct fees from escrow
        job.escrow = job.escrow.sub(fees);
        // Add fees to transcoder's fee pool
        bondingManager().updateTranscoderWithFees(msg.sender, fees, job.creationRound);

        // Set claim as complete
        claim.status = ClaimStatus.Complete;

        return true;
    }

    /*
     * @dev Compute status of job
     * @param _jobId Job identifier
     */
    function jobStatus(uint256 _jobId) public view returns (JobStatus) {
        if (jobs[_jobId].endBlock <= block.number) {
            // A job is inactive if the current block is greater than or equal to the job's end block
            return JobStatus.Inactive;
        } else {
            // A job is active if the current block is less than the job's end block
            return JobStatus.Active;
        }
    }

    /*
     * @dev Return job info
     * @param _jobId Job identifier
     */
    function getJob(
        uint256 _jobId
    )
        public
        view
        returns (string streamId, string transcodingOptions, uint256 maxPricePerSegment, address broadcasterAddress, address transcoderAddress, uint256 creationRound, uint256 creationBlock, uint256 endBlock, uint256 escrow, uint256 totalClaims)
    {
        Job storage job = jobs[_jobId];

        streamId = job.streamId;
        transcodingOptions = job.transcodingOptions;
        maxPricePerSegment = job.maxPricePerSegment;
        broadcasterAddress = job.broadcasterAddress;
        transcoderAddress = job.transcoderAddress;
        creationRound = job.creationRound;
        creationBlock = job.creationBlock;
        endBlock = job.endBlock;
        escrow = job.escrow;
        totalClaims = job.claims.length;
    }

    /*
     * @dev Return claim info
     * @param _jobId Job identifier
     * @param _claimId Claim identifier
     */
    function getClaim(
        uint256 _jobId,
        uint256 _claimId
    )
        public
        view
        returns (uint256[2] segmentRange, bytes32 claimRoot, uint256 claimBlock, uint256 endVerificationBlock, uint256 endSlashingBlock, ClaimStatus status)
    {
        Claim storage claim = jobs[_jobId].claims[_claimId];

        segmentRange = claim.segmentRange;
        claimRoot = claim.claimRoot;
        claimBlock = claim.claimBlock;
        endVerificationBlock = claim.endVerificationBlock;
        endSlashingBlock = claim.endSlashingBlock;
        status = claim.status;
    }

    /*
     * @dev Return whether a segment was verified for a claim
     * @param _jobId Job identifier
     * @param _claimId Claim identifier
     * @param _segmentNumber Segment number
     */
    function isClaimSegmentVerified(
        uint256 _jobId,
        uint256 _claimId,
        uint256 _segmentNumber
    )
        public
        view
        returns (bool)
    {
        return jobs[_jobId].claims[_claimId].segmentVerifications[_segmentNumber];
    }

    /*
     * @dev Refund broadcaster for a job
     * @param _jobId Job identifier
     */
    function refundBroadcaster(uint256 _jobId) internal returns (bool) {
        Job storage job = jobs[_jobId];

        // Return all escrowed fees for a job
        uint256 fees = job.escrow;
        job.escrow = job.escrow.sub(fees);
        broadcasters[job.broadcasterAddress].deposit = broadcasters[job.broadcasterAddress].deposit.add(fees);

        return true;
    }

    /*
     * @dev Returns LivepeerToken
     */
    function livepeerToken() internal view returns (ILivepeerToken) {
        return ILivepeerToken(controller.getContract(keccak256("LivepeerToken")));
    }

    /*
     * @dev Returns Minter
     */
    function minter() internal view returns (IMinter) {
        return IMinter(controller.getContract(keccak256("Minter")));
    }

    /*
     * @dev Returns BondingManager
     */
    function bondingManager() internal view returns (IBondingManager) {
        return IBondingManager(controller.getContract(keccak256("BondingManager")));
    }

    /*
     * @dev Returns RoundsManager
     */
    function roundsManager() internal view returns (IRoundsManager) {
        return IRoundsManager(controller.getContract(keccak256("RoundsManager")));
    }

    /*
     * @dev Returns Verifier
     */
    function verifier() internal view returns (IVerifier) {
        return IVerifier(controller.getContract(keccak256("Verifier")));
    }
}
