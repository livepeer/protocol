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
import "../libraries/MathUtils.sol";

import "zeppelin-solidity/contracts/math/SafeMath.sol";


contract JobsManager is ManagerProxyTarget, IVerifiable, IJobsManager {
    using SafeMath for uint256;

    // % of segments to be verified. 1 / verificationRate == % to be verified
    uint64 public verificationRate;

    // Time after a transcoder calls claimWork() that it has to complete verification of claimed work
    uint256 public verificationPeriod;

    // Time after a claim's verification period during which anyone can slash the transcoder for missing a required verification
    uint256 public verificationSlashingPeriod;

    // % of stake slashed for failed verification
    uint256 public failedVerificationSlashAmount;

    // % of stake slashed for missed verification
    uint256 public missedVerificationSlashAmount;

    // % of stake slashed for double claiming a segment
    uint256 public doubleClaimSegmentSlashAmount;

    // % of of slashed amount awarded to finder
    uint256 public finderFee;

    struct Broadcaster {
        uint256 deposit;         // Deposited ETH for jobs
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
        uint256 endVerificationSlashingBlock;              // End of verification slashing period for this claim
        mapping (uint256 => bool) segmentVerifications;    // Mapping segment number => whether segment was submitted for verification
        ClaimStatus status;                                // Status of claim (pending, slashed, complete)
    }

    // States of a transcode claim
    enum ClaimStatus { Pending, Slashed, Complete }

    // Transcode jobs
    mapping (uint256 => Job) public jobs;
    // Number of jobs created. Also used for sequential identifiers
    uint256 public numJobs;

    // Check if sender is Verifier
    modifier onlyVerifier() {
        require(msg.sender == controller.getContract(keccak256("Verifier")));
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

    function JobsManager(address _controller) public Manager(_controller) {}

    /*
     * @dev Set verification rate. Only callable by the controller owner
     * @param _verificationRate Verification rate such that 1 / verificationRate of segments are challenged
     */
    function setVerificationRate(uint64 _verificationRate) external onlyControllerOwner {
        // verificationRate cannot be 0
        require(_verificationRate > 0);

        verificationRate = _verificationRate;

        ParameterUpdate("verificationRate");
    }

    /*
     * @dev Set verification period. Only callable by the controller owner
     * @param _verificationPeriod Number of blocks to complete verification of claimed work
     */
    function setVerificationPeriod(uint256 _verificationPeriod) external onlyControllerOwner {
        // Verification period + verification slashing period currently cannot be longer than 256 blocks
        // because contracts can only access the last 256 blocks from
        // the current block
        require(_verificationPeriod.add(verificationSlashingPeriod) <= 256);

        verificationPeriod = _verificationPeriod;

        ParameterUpdate("verificationPeriod");
    }

    /*
     * @dev Set verification slashing period. Only callable by the controller owner
     * @param _verificationSlashingPeriod Number of blocks after the verification period to submit slashing proofs
     */
    function setVerificationSlashingPeriod(uint256 _verificationSlashingPeriod) external onlyControllerOwner {
        // Verification period + verification slashing period currently cannot be longer than 256 blocks
        // because contracts can only access the last 256 blocks from
        // the current block
        require(verificationPeriod.add(_verificationSlashingPeriod) <= 256);

        verificationSlashingPeriod = _verificationSlashingPeriod;

        ParameterUpdate("verificationSlashingPeriod");
    }

    /*
     * @dev Set failed verification slash amount. Only callable by the controller owner
     * @param _failedVerificationSlashAmount % of stake slashed for failed verification
     */
    function setFailedVerificationSlashAmount(uint256 _failedVerificationSlashAmount) external onlyControllerOwner {
        // Must be a valid percentage
        require(MathUtils.validPerc(_failedVerificationSlashAmount));

        failedVerificationSlashAmount = _failedVerificationSlashAmount;

        ParameterUpdate("failedVerificationSlashAmount");
    }

    /*
     * @dev Set missed verification slash amount. Only callable by the controller owner
     * @param _missedVerificationSlashAmount % of stake slashed for missed verification
     */
    function setMissedVerificationSlashAmount(uint256 _missedVerificationSlashAmount) external onlyControllerOwner {
        // Must be a valid percentage
        require(MathUtils.validPerc(_missedVerificationSlashAmount));

        missedVerificationSlashAmount = _missedVerificationSlashAmount;

        ParameterUpdate("missedVerificationSlashAmount");
    }

    /*
     * @dev Set double claim slash amount. Only callable by the controller owner
     * @param _doubleClaimSegmentSlashAmount % of stake slashed for double claiming a segment
     */
    function setDoubleClaimSegmentSlashAmount(uint256 _doubleClaimSegmentSlashAmount) external onlyControllerOwner {
        // Must be a valid percentage
        require(MathUtils.validPerc(_doubleClaimSegmentSlashAmount));

        doubleClaimSegmentSlashAmount = _doubleClaimSegmentSlashAmount;

        ParameterUpdate("doubleClaimSegmentSlashAmount");
    }

    /*
     * @dev Set finder fee. Only callable by the controller owner
     * @param _finderFee % of slashed amount awarded to finder
     */
    function setFinderFee(uint256 _finderFee) external onlyControllerOwner {
        // Must be a valid percentage
        require(MathUtils.validPerc(_finderFee));

        finderFee = _finderFee;
    }

    /*
     * @dev Deposit ETH for jobs
     */
    function deposit() external payable whenSystemNotPaused {
        broadcasters[msg.sender].deposit = broadcasters[msg.sender].deposit.add(msg.value);
        // Transfer ETH for deposit to Minter
        minter().depositETH.value(msg.value)();

        Deposit(msg.sender, msg.value);
    }

    /*
     * @dev Withdraw deposited funds
     */
    function withdraw() external whenSystemNotPaused {
        // Can only withdraw at or after the broadcster's withdraw block
        require(broadcasters[msg.sender].withdrawBlock <= roundsManager().blockNum());

        uint256 amount = broadcasters[msg.sender].deposit;
        delete broadcasters[msg.sender];
        minter().trustedWithdrawETH(msg.sender, amount);

        Withdraw(msg.sender);
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
        whenSystemNotPaused
    {
        uint256 blockNum = roundsManager().blockNum();

        // End block must be in the future
        require(_endBlock > blockNum);
        // Transcoding options must be valid
        require(JobLib.validTranscodingOptions(_transcodingOptions));

        Job storage job = jobs[numJobs];
        job.jobId = numJobs;
        job.streamId = _streamId;
        job.transcodingOptions = _transcodingOptions;
        job.maxPricePerSegment = _maxPricePerSegment;
        job.broadcasterAddress = msg.sender;
        job.creationRound = roundsManager().currentRound();
        job.creationBlock = blockNum;
        job.endBlock = _endBlock;

        NewJob(
            msg.sender,
            numJobs,
            _streamId,
            _transcodingOptions,
            _maxPricePerSegment,
            blockNum
        );

        // Increment number of created jobs
        numJobs = numJobs.add(1);

        if (_endBlock > broadcasters[msg.sender].withdrawBlock) {
            // Set new withdraw block if job end block is greater than current
            // broadcaster withdraw block
            broadcasters[msg.sender].withdrawBlock = _endBlock;
        }
    }

    /*
     * @dev Submit claim for a range of segments
     * @param _jobId Job identifier
     * @param _segmentRange Range of claimed segments
     * @param _claimRoot Merkle root of transcoded segment proof data for claimed segments
     */
    function claimWork(uint256 _jobId, uint256[2] _segmentRange, bytes32 _claimRoot)
        external
        whenSystemNotPaused
        jobExists(_jobId)
    {
        Job storage job = jobs[_jobId];

        // Job cannot be inactive
        require(jobStatus(_jobId) != JobStatus.Inactive);
        // Segment range must be valid
        require(_segmentRange[1] >= _segmentRange[0]);
        // Caller must be registered transcoder
        require(bondingManager().isRegisteredTranscoder(msg.sender));

        uint256 blockNum = roundsManager().blockNum();

        if (job.transcoderAddress != address(0)) {
            // If transcoder already assigned, check if sender is
            // the assigned transcoder
            require(job.transcoderAddress == msg.sender);
        } else {
            // If transcoder is not already assigned, check if sender should be assigned
            // roundsManager.blockHash() will ensure that the job creation block has been mined and it has not
            // been more than 256 blocks since the creation block
            require(bondingManager().electActiveTranscoder(job.maxPricePerSegment, roundsManager().blockHash(job.creationBlock), job.creationRound) == msg.sender);

            job.transcoderAddress = msg.sender;
        }

        // Move fees from broadcaster deposit to escrow
        uint256 fees = JobLib.calcFees(_segmentRange[1].sub(_segmentRange[0]).add(1), job.transcodingOptions, job.maxPricePerSegment);
        broadcasters[job.broadcasterAddress].deposit = broadcasters[job.broadcasterAddress].deposit.sub(fees);
        job.escrow = job.escrow.add(fees);

        uint256 endVerificationBlock = blockNum.add(verificationPeriod);
        uint256 endVerificationSlashingBlock = endVerificationBlock.add(verificationSlashingPeriod);

        job.claims.push(
            Claim({
                claimId: job.claims.length,
                segmentRange: _segmentRange,
                claimRoot: _claimRoot,
                claimBlock: blockNum,
                endVerificationBlock: endVerificationBlock,
                endVerificationSlashingBlock: endVerificationSlashingBlock,
                status: ClaimStatus.Pending
           })
        );

        NewClaim(job.transcoderAddress, _jobId, job.claims.length - 1);
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
        whenSystemNotPaused
        sufficientPayment
        jobExists(_jobId)
    {
        Job storage job = jobs[_jobId];
        Claim storage claim = job.claims[_claimId];

        // Sender must be elected transcoder
        require(job.transcoderAddress == msg.sender);

        uint256 challengeBlock = claim.claimBlock + 1;
        // Segment must be eligible for verification
        // roundsManager().blockHash() ensures that the challenge block is within the last 256 blocks from the current block
        require(JobLib.shouldVerifySegment(_segmentNumber, claim.segmentRange, challengeBlock, roundsManager().blockHash(challengeBlock), verificationRate));
        // Segment must be signed by broadcaster
        require(
            JobLib.validateBroadcasterSig(
                job.streamId,
                _segmentNumber,
                _dataHashes[0],
                _broadcasterSig,
                job.broadcasterAddress
            )
        );
        // Receipt must be valid
        require(
            JobLib.validateReceipt(
                job.streamId,
                _segmentNumber,
                _dataHashes[0],
                _dataHashes[1],
                _broadcasterSig,
                _proof,
                claim.claimRoot
           )
        );

        // Mark segment as submitted for verification
        claim.segmentVerifications[_segmentNumber] = true;

        // Invoke transcoding verification. This is async and will result in a callback to receiveVerification() which is implemented by this contract
        invokeVerification(_jobId, _claimId, _segmentNumber, _dataStorageHash, _dataHashes);

        Verify(msg.sender, _jobId, _claimId, _segmentNumber);
    }

    /*
     * @dev Callback function that receives the results of transcoding verification
     * @param _jobId Job identifier
     * @param _segmentNumber Segment being verified for job
     * @param _result Boolean result of whether verification succeeded or not
     */
    function receiveVerification(uint256 _jobId, uint256 _claimId, uint256 _segmentNumber, bool _result)
        external
        whenSystemNotPaused
        onlyVerifier
        jobExists(_jobId)
    {
        Job storage job = jobs[_jobId];
        Claim storage claim = job.claims[_claimId];
        // Claim must not be slashed
        require(claim.status != ClaimStatus.Slashed);
        // Segment must have been submitted for verification
        require(claim.segmentVerifications[_segmentNumber]);

        address transcoder = job.transcoderAddress;

        if (!_result) {
            // Refund broadcaster
            refundBroadcaster(_jobId);
            // Set claim as slashed
            claim.status = ClaimStatus.Slashed;
            // Protocol slashes transcoder for failing verification (no finder)
            bondingManager().slashTranscoder(transcoder, address(0), failedVerificationSlashAmount, 0);

            FailedVerification(transcoder, _jobId, _claimId, _segmentNumber);
        } else {
            PassedVerification(transcoder, _jobId, _claimId, _segmentNumber);
        }
    }

    /*
     * @dev Distribute fees for multiple claims
     * @param _jobId Job identifier
     * @param _claimId Claim identifier
     */
    function batchDistributeFees(uint256 _jobId, uint256[] _claimIds)
        external
        whenSystemNotPaused
    {
        for (uint256 i = 0; i < _claimIds.length; i++) {
            distributeFees(_jobId, _claimIds[i]);
        }
    }

    /*
     * @dev Slash transcoder for missing verification
     * @param _jobId Job identifier
     * @param _claimId Claim identifier
     * @param _segmentNumber Segment that was not verified
     */
    function missedVerificationSlash(uint256 _jobId, uint256 _claimId, uint256 _segmentNumber)
        external
        whenSystemNotPaused
        jobExists(_jobId)
    {
        Job storage job = jobs[_jobId];
        Claim storage claim = job.claims[_claimId];

        uint256 blockNum = roundsManager().blockNum();
        uint256 challengeBlock = claim.claimBlock + 1;
        // Must be after verification period
        require(blockNum >= claim.endVerificationBlock);
        // Must be before end of slashing period
        require(blockNum < claim.endVerificationSlashingBlock);
        // Claim must be pending
        require(claim.status == ClaimStatus.Pending);
        // Segment must be eligible for verification
        // roundsManager().blockHash() ensures that the challenge block is within the last 256 blocks from the current block
        require(JobLib.shouldVerifySegment(_segmentNumber, claim.segmentRange, challengeBlock, roundsManager().blockHash(challengeBlock), verificationRate));
        // Transcoder must have missed verification for the segment
        require(!claim.segmentVerifications[_segmentNumber]);

        refundBroadcaster(_jobId);

        // Slash transcoder and provide finder params
        bondingManager().slashTranscoder(job.transcoderAddress, msg.sender, missedVerificationSlashAmount, finderFee);

        // Set claim as slashed
        claim.status = ClaimStatus.Slashed;
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
        whenSystemNotPaused
        jobExists(_jobId)
    {
        Job storage job = jobs[_jobId];
        Claim storage claim1 = job.claims[_claimId1];
        Claim storage claim2 = job.claims[_claimId2];

        // Claim 1 must not be slashed
        require(claim1.status != ClaimStatus.Slashed);
        // Claim 2 must not be slashed
        require(claim2.status != ClaimStatus.Slashed);
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
    }

    /*
     * @dev Distribute fees for a particular claim
     * @param _jobId Job identifier
     * @param _claimId Claim identifier
     */
    function distributeFees(uint256 _jobId, uint256 _claimId)
        public
        whenSystemNotPaused
        jobExists(_jobId)
    {
        Job storage job = jobs[_jobId];
        Claim storage claim = job.claims[_claimId];

        // Sender must be elected transcoder for job
        require(job.transcoderAddress == msg.sender);
        // Claim must not be complete
        require(claim.status == ClaimStatus.Pending);
        // Slashing period must be over for claim
        require(claim.endVerificationSlashingBlock <= roundsManager().blockNum());

        uint256 fees = JobLib.calcFees(claim.segmentRange[1].sub(claim.segmentRange[0]).add(1), job.transcodingOptions, job.maxPricePerSegment);
        // Deduct fees from escrow
        job.escrow = job.escrow.sub(fees);
        // Add fees to transcoder's fee pool
        bondingManager().updateTranscoderWithFees(msg.sender, fees, job.creationRound);

        // Set claim as complete
        claim.status = ClaimStatus.Complete;

        DistributeFees(msg.sender, _jobId, _claimId, fees);
    }

    /*
     * @dev Compute status of job
     * @param _jobId Job identifier
     */
    function jobStatus(uint256 _jobId) public view returns (JobStatus) {
        if (jobs[_jobId].endBlock <= roundsManager().blockNum()) {
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
        returns (uint256[2] segmentRange, bytes32 claimRoot, uint256 claimBlock, uint256 endVerificationBlock, uint256 endVerificationSlashingBlock, ClaimStatus status)
    {
        Claim storage claim = jobs[_jobId].claims[_claimId];

        segmentRange = claim.segmentRange;
        claimRoot = claim.claimRoot;
        claimBlock = claim.claimBlock;
        endVerificationBlock = claim.endVerificationBlock;
        endVerificationSlashingBlock = claim.endVerificationSlashingBlock;
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
    {
        IVerifier verifierContract = verifier();

        uint256 price = verifierContract.getPrice();

        // Send payment to verifier if price is greater than zero
        if (price > 0) {
            verifierContract.verify.value(price)(
                _jobId,
                _claimId,
                _segmentNumber,
                jobs[_jobId].transcodingOptions,
                _dataStorageHash,
                _dataHashes
            );
        } else {
            // If price is 0, reject any value transfers
            require(msg.value == 0);

            verifierContract.verify(
                _jobId,
                _claimId,
                _segmentNumber,
                jobs[_jobId].transcodingOptions,
                _dataStorageHash,
                _dataHashes
            );
        }
    }

    /*
     * @dev Refund broadcaster for a job
     * @param _jobId Job identifier
     */
    function refundBroadcaster(uint256 _jobId) internal {
        Job storage job = jobs[_jobId];

        // Return all escrowed fees for a job
        uint256 fees = job.escrow;
        job.escrow = job.escrow.sub(fees);
        broadcasters[job.broadcasterAddress].deposit = broadcasters[job.broadcasterAddress].deposit.add(fees);
        // Set end block of job to current block - job becomes inactive
        job.endBlock = roundsManager().blockNum();
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
