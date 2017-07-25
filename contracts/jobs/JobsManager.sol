pragma solidity ^0.4.11;

import "./IJobsManager.sol";
import "../Controllable.sol";
import "../LivepeerProtocol.sol";
import "../bonding/IBondingManager.sol";
import "../verification/Verifiable.sol";
import "../verification/Verifier.sol";
import "./libraries/TranscodeJobs.sol";

contract JobsManager is IJobsManager, Verifiable, Controllable {
    using TranscodeJobs for TranscodeJobs.Jobs;

    // Verifier address
    Verifier public verifier;

    // % of segments to be verified. 1 / verificationRate == % to be verified
    uint64 public verificationRate;

    // % of verifications you can fail before being slashed
    uint64 public verificationFailureThreshold;

    // Time between when endJob() is called for a job and when the job is considered inactive. Denominated in blocks
    uint256 public jobEndingPeriod;

    // Time after a transcoder calls claimWork() that it has to complete verification of claimed work
    uint256 public verificationPeriod;

    // Transcoding jobs
    TranscodeJobs.Jobs jobs;

    // Check if sender is Verifier contract
    modifier onlyVerifier() {
        if (msg.sender != address(verifier)) throw;
        _;
    }

    // Events
    event NewJob(address indexed transcoder, address indexed broadcaster, uint256 jobId);

    function JobsManager(address _verifier) {
        // Set Verifier address
        verifier = Verifier(_verifier);

        // Verify all segments.
        // TODO: This is a test value. We will need to provide a realistic default value
        verificationRate = 1;

        // A job becomes inactive 100 blocks after endJob() is called
        jobEndingPeriod = 100;

        // A transcoder has 100 blocks for verification after claiming work
        verificationPeriod = 100;
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
     */
    function job(string _streamId, string _transcodingOptions, uint256 _maxPricePerSegment) external returns (bool) {
        address electedTranscoder = bondingManager().electActiveTranscoder(_maxPricePerSegment);

        // Check if there is an elected current active transcoder
        if (electedTranscoder == address(0)) throw;

        return jobs.newJob(_streamId, _transcodingOptions, _maxPricePerSegment, electedTranscoder);
    }

    /*
     * @dev Return job details
     * @param _jobId Job identifier
     */
    function getJobDetails(uint256 _jobId) public constant returns (uint256, uint256, address, address, uint256) {
        return jobs.getJobDetails(_jobId);
    }

    /*
     * @dev Return stream id for job
     * @param _jobId Job identifier
     */
    function getJobStreamId(uint256 _jobId) public constant returns (string) {
        return jobs.jobs[_jobId].streamId;
    }

    /*
     * @dev Return transcoding options for job
     * @param _jobId Job identifier
     */
    function getJobTranscodingOptions(uint256 _jobId) public constant returns (string) {
        return jobs.jobs[_jobId].transcodingOptions;
    }

    /*
     * @dev Return transcode claims details for a job
     * @param _jobId Job identifier
     */
    function getJobTranscodeClaimsDetails(uint256 _jobId) public constant returns (uint256, uint256, uint256, uint256, bytes32) {
        return jobs.getJobTranscodeClaimsDetails(_jobId);
    }

    /*
     * @dev End a job. Can be called by either a broadcaster or transcoder of a job
     * @param _jobId Job identifier
     */
    function endJob(uint256 _jobId) external returns (bool) {
        return jobs.endJob(_jobId, jobEndingPeriod);
    }

    /*
     * @dev Submit transcode claims for a range of segments
     * @param _jobId Job identifier
     * @param _startSegmentSequenceNumber First segment in the range of transcoded segments
     * @param _endSegmentSequenceNumber Second segment in the range of transcoded segments
     * @param _transcodeClaimRoot Merkle root of transcode claims for the range of segments
     */
    function claimWork(uint256 _jobId, uint256 _startSegmentSequenceNumber, uint256 _endSegmentSequenceNumber, bytes32 _transcodeClaimsRoot) external returns (bool) {
        return jobs.claimWork(_jobId, _startSegmentSequenceNumber, _endSegmentSequenceNumber, _transcodeClaimsRoot, verificationPeriod);
    }

    /*
     * @dev Provide proof of transcoding a segment
     * TODO: This might have to be payable when we implement the transcoding verification process using a solution such as Oraclize or Truebit
     * @param _jobId Job identifier
     * @param _segmentSequenceNumber Segment sequence number in stream
     * @param _dataHash Segment data hash. Used to retrieve segment data from Swarm
     * @param _transcodedDataHash Transcoded segment data hash. Used to retrieve transcoded segment data from Swarm
     * @param _broadcasterSig Broadcaster's signature over segment
     * @param _proof Merkle proof for the signed transcode claim
     */
    function verify(uint256 _jobId, uint256 _segmentSequenceNumber, bytes32 _dataHash, bytes32 _transcodedDataHash, bytes _broadcasterSig, bytes _proof) payable external returns (bool) {
        if (!jobs.validateTranscoderClaim(_jobId, _segmentSequenceNumber, _dataHash, _transcodedDataHash, _broadcasterSig, _proof, verificationRate)) throw;

        // TODO: use a real verification code hash
        bytes32 verificationCodeHash = 0x2222;
        // Invoke transcoding verification. This is async and will result in a callback to receiveVerification() which is implemented by this contract
        verifier.verify(_jobId, _segmentSequenceNumber, verificationCodeHash, _dataHash, _transcodedDataHash, this);

        return true;
    }

    /*
     * @dev Callback function that receives the results of transcoding verification
     * @param _jobId Job identifier
     * @param _segmentSequenceNumber Segment being verified for job
     * @param _result Boolean result of whether verification succeeded or not
     */
    function receiveVerification(uint256 _jobId, uint256 _segmentSequenceNumber, bool _result) onlyVerifier external returns (bool) {
        // TODO: Check if result matches transcoded data hash

        return true;
    }
}
