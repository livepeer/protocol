pragma solidity ^0.4.11;

import "./IJobsManager.sol";
import "./libraries/JobLib.sol";
import "../Controllable.sol";
import "../LivepeerProtocol.sol";
import "../LivepeerToken.sol";
import "../bonding/IBondingManager.sol";
import "../verification/Verifiable.sol";
import "../verification/Verifier.sol";

contract JobsManager is IJobsManager, Verifiable, Controllable {
    // Token address
    LivepeerToken public token;

    // Verifier address
    Verifier public verifier;

    // Content-addressed storage hash of verification code
    string public verificationCodeHash;

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
        uint256 deposit;                      // Fees deposited by broadcaster
        uint256 escrow;                       // Fees held after claims before verification and slashing periods are complete
    }

    struct Claim {
        uint256 claimsId;                     // Unique identifier for claim
        uint256[2] segmentRange;              // Range of segments claimed
        bytes32 claimRoot;                    // Merkle root of segment transcode proof data
        uint256 claimedBlock;                 // Block number that claim was submitted
        uint256 endVerificationBlock;         // End of verification period for this claim
        uint256 endSlashingBlock;             // End of slashing period for this claim
        mapping (uint256 => bool) segmentVerifications; // Mapping segment number => whether segment was submitted for verification
        ClaimStatus status;                   // Status of claim (pending, slashed, complete)
    }

    enum ClaimStatus { Pending, Slashed, Complete }

    // Transcoding jobs
    Job[] jobs;

    // Check if sender is Verifier contract
    modifier onlyVerifier() {
        if (msg.sender != address(verifier)) throw;
        _;
    }

    // Events
    event NewJob(address indexed transcoder, address indexed broadcaster, uint256 jobId);

    function JobsManager(address _token, address _verifier) {
        // Set LivepeerToken address
        token = LivepeerToken(_token);
        // Set Verifier address
        verifier = Verifier(_verifier);
        // Verify all segments.
        // TODO: This is a test value. We will need to provide a realistic default value
        verificationRate = 1;
        // A job becomes inactive 100 blocks after endJob() is called
        jobEndingPeriod = 100;
        // A transcoder has 100 blocks for verification after claiming work
        verificationPeriod = 100;
        // Slashing period after verification is 100 blocks
        slashingPeriod = 100;
        // Stake slashed by 20% for a failed verification
        failedVerificationSlashAmount = 20;
        // Stake slashed by 30% for a missed verification
        missedVerificationSlashAmount = 30;
    }

    /*
     * @dev Returns BondingManager
     */
    function bondingManager() internal constant returns (IBondingManager) {
        LivepeerProtocol protocol = LivepeerProtocol(controller);

        return IBondingManager(protocol.getRegistryContract(protocol.bondingManagerKey()));
    }

    /*
     * @dev Submit a transcoding job
     * @param _streamId Unique stream identifier
     * @param _transcodingOptions Output bitrates, formats, encodings
     * @param _maxPricePerSegment Max price (in LPT base units) to pay for transcoding a segment of a stream
     * @param _deposit Deposited LPT funds for the job
     */
    function job(string _streamId, string _transcodingOptions, uint256 _maxPricePerSegment, uint256 _deposit) external returns (bool) {
        address electedTranscoder = bondingManager().electActiveTranscoder(_maxPricePerSegment);
        // There must be an elected transcoder
        require(electedTranscoder != address(0));

        jobs.push(Job({
            jobId: jobs.length,
            streamId: _streamId,
            transcodingOptions: _transcodingOptions,
            maxPricePerSegment: _maxPricePerSegment,
            broadcasterAddress: msg.sender,
            transcoderAddress: electedTranscoder,
            deposit: _deposit
        }));

        // Create deposit for job. Sender needs to approve deposited amount first
        token.transferFrom(msg.sender, this, _deposit);

        NewJob(electedTranscoder, msg.sender, jobs.length - 1);

        return true;
    }

    /*
     * @dev Compute status of job
     * @param self Jobs struct storage receiver
     * @param _jobId Job identifier
     */
    function jobStatus(uint256 _jobId) internal constant returns (JobStatus) {
        if (jobs[_jobId].endBlock > 0 && jobs[_jobId].endBlock <= block.number) {
            // A job is inactive if its end block is set and the current block is greater than or equal to the job's end block
            return JobStatus.Inactive;
        } else {
            // A job is active if the current block is less than the job's termination block
            return JobStatus.Active;
        }
    }

    /*
     * @dev Return job details
     * @param _jobId Job identifier
     */
    function getJobDetails(uint256 _jobId) public constant returns (string, string, uint256, address, address, uint256) {
        Job storage job = jobs[_jobId];

        return (job.streamId, job.transcodingOptions, job.maxPricePerSegment, job.broadcasterAddress, job.transcoderAddress);
    }

    /*
     * @dev Return claim details
     * @param _jobId Job identifier
     * @param _claimId Claim identifier
     */
    function getClaimDetails(uint256 _jobId, uint256 _claimId) public constant returns (uint256[2], bytes32, uint256, bytes32, uint256) {
        Claim storage claim = jobs[_jobId].claims[_claimId];

        return (claim.segmentRange, claim.claimRoot, claim.claimedBlock, claim.endVerificationBlock, claim.endSlashingBlock);
    }

    /*
     * @dev End a job. Can be called by either a broadcaster or transcoder of a job
     * @param _jobId Job identifier
     */
    function endJob(uint256 _jobId) external returns (bool) {
        Job storage job = jobs[_jobId];

        // Job must not already have an end block
        require(job.endBlock == 0);
        // Sender must be the job's broadcaster or elected transcoder
        require(job.broadcasterAddress == msg.sender || jobs[_jobId].transcoderAddress == msg.sender);

        // Set end block for job
        job.endBlock = block.number.add(jobEndingPeriod);
    }

    /*
     * @dev Submit claim for a range of segments
     * @param _jobId Job identifier
     * @param _segmentRange Range of claimed segments
     * @param _claimRoot Merkle root of transcoded segment proof data for claimed segments
     */
    function claimWork(uint256 _jobId, uint256[2] _segmentRange, bytes32 _claimRoot) external returns (bool) {
        Job storage job = jobs[_jobId];

        // Job must be active
        require(jobStatus(_jobId) == JobStatus.Active);
        // Sender must be elected transcoder
        require(job.transcoderAddress == msg.sender);

        // Move fees from broadcaster deposit to escrow
        uint256 fees = _segmentRange[1].sub(_segmentRange[0]).mul(job.maxPricePerSegment);
        job.deposit = job.deposit.sub(fees);
        job.escrow = job.escrow.add(fees);

        job.claims.push(Claim({
            claimId: jobs.claims.length,
            segmentRange: _segmentRange,
            claimRoot: _claimRoot,
            claimBlock: block.number,
            endVerificationBlock: block.number.add(verificationPeriod)
            endSlashingBlock: block.number.add(verificationPeriod).add(slashingPeriod),
            status: ClaimStatus.Pending
        }));

        return true;
    }

    /*
     * @dev Provide proof of transcoding a segment
     * @param _jobId Job identifier
     * @param _segmentSequenceNumber Segment sequence number in stream
     * @param _dataHash Content-addressed storage hash of segment data
     * @param _transcodedDataHash Hash of transcoded segment data
     * @param _broadcasterSig Broadcaster's signature over segment
     * @param _proof Merkle proof for the signed transcode claim
     */
    function verify(uint256 _jobId, uint256 _claimId, uint256 _segmentNumber, string _dataHash, string _transcodedDataHash, bytes _broadcasterSig, bytes _proof) payable external returns (bool) {
        Job storage job = jobs[_jobId];
        Claim storage claim = job.claims[_claimId];

        // Job must be active
        require(jobStatus(_jobId) == JobStatus.Active);
        // Sender must be elected transcoder
        require(job.transcoderAddress == msg.sender);

        // Segment must be eligible for verification
        require(JobLib.shouldVerifySegment(_segmentNumber, claim.segmentRange, claim.claimBlock, verificationRate));
        // Segment must be signed by broadcaster
        require(ECRecovery.recover(JobLib.personalSegmentHash(job.streamId, _segmentNumber, _dataHash), _broadcasterSig) == job.transcoderAddress);
        // Transcode receipt hash must be included in original claim
        require(MerkleProof.verifyProof(_proof, job.claimRoot, JobLib.transcodeReceiptHash(job.streamId, _segmentNumber, _dataHash, _transcodedDataHash, _broadcasterSig)));

        // Mark segment as submitted for verification
        claim.segmentVerifications[_segmentNumber] = true;

        // Invoke transcoding verification. This is async and will result in a callback to receiveVerification() which is implemented by this contract
        verifier.verify(_jobId, _segmentNumber, verificationCodeHash, _dataHash, _transcodedDataHash, this);

        return true;
    }

    /*
     * @dev Callback function that receives the results of transcoding verification
     * @param _jobId Job identifier
     * @param _segmentNumber Segment being verified for job
     * @param _result Boolean result of whether verification succeeded or not
     */
    function receiveVerification(uint256 _jobId, uint256 _segmentNumber, bool _result) onlyVerifier external returns (bool) {
        if (!_result) {
            bondingManager().slashTranscoder(jobs[_jobId].transcoderAddress, address(0), failedVerificationSlashAmount, 0);
        }

        return true;
    }

    /*
     * @dev Distribute fees for a particular claim
     * @param _jobId Job identifier
     * @param _claimId Claim identifier
     */
    function distributeFees(uint256 _jobId, uint256 _claimId) public returns (bool) {
        Job storage job = jobs[_jobId];
        Claim storage claim = job.claims[_claimId];

        // Sender must be elected transcoder for job
        require(job.transcoderAddress == msg.sender);
        // Claim must not be complete
        require(claim.status == ClaimStatus.Pending);
        // Slashing period must be over for claim
        require(claim.endSlashingBlock < block.number);

        uint256 fees = claim.segmentRange[1].sub(claim.segmentRange[0]).mul(job.maxPricePerSegment);
        // Deduct fees from escrow
        job.escrow = job.escrow.sub(fees);
        // Add fees to transcoder's fee pool
        bondingManager().updateTranscoderFeePool(msg.sender, fees);

        // Set claim as complete
        claim.status = ClaimStatus.Complete;

        return true;
    }

    /*
     * @dev Distribute fees for multiple claims
     * @param _jobId Job identifier
     * @param _claimId Claim identifier
     */
    function batchDistributeFees(uint256 _jobId, uint256[] _claimIds) public returns (bool) {
        for (uint256 = i; i < _claimIds.length; i++) {
            distributeFees(_jobId, _claimIds[i]);
        }

        return true;
    }

    function missedVerificationSlash(uint256 _jobId, uint256 _claimId, uint256 _segmentNumber) public returns (bool) {
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

        // Return escrowed fees for claim
        uint256 fees = claim.segmentRange[1].sub(claim.segmentRange[0]).mul(job.maxPricePerSegment);
        job.escrow = job.escrow.sub(fees);
        job.deposit = job.deposit.add(fees);

        // Slash and remove transcoder
        bondingManager().slashTranscoder(job.transcoderAddress, msg.sender, missedVerificationSlashAmount, finderFee);

        claim.status = ClaimStatus.Slashed;

        return true;
    }
}
