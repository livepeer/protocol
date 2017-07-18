pragma solidity ^0.4.11;

import "./IJobsManager.sol";
import "../Controllable.sol";
import "../LivepeerProtocol.sol";
import "../bonding/IBondingManager.sol";
import "./libraries/TranscodeJobs.sol";

contract JobsManager is IJobsManager, Controllable {
    using TranscodeJobs for TranscodeJobs.Jobs;

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

    // Events
    event NewJob(address indexed transcoder, address indexed broadcaster, uint256 jobId);

    function JobsManager() {
        // Verify all segments.
        // TODO: This is a test value. We will need to provide a realistic default value
        verificationRate = 1;

        // A job becomes inactive 100 blocks after endJob() is called
        jobEndingPeriod = 100;

        // A transcoder has 100 blocks for verification after claiming work
        verificationPeriod = 100;
    }

    function bondingManager() constant returns (IBondingManager) {
        LivepeerProtocol protocol = LivepeerProtocol(controller);

        return IBondingManager(protocol.getRegistryContract(protocol.bondingManagerKey()));
    }

    /*
     * @dev Submit a transcoding job
     * @param _streamId Unique stream identifier
     * @param _transcodingOptions Output bitrates, formats, encodings
     * @param _maxPricePerSegment Max price (in LPT base units) to pay for transcoding a segment of a stream
     */
    function job(string _streamId, bytes32 _transcodingOptions, uint256 _maxPricePerSegment) returns (bool) {
        address electedTranscoder = bondingManager().electActiveTranscoder(_maxPricePerSegment);

        // Check if there is an elected current active transcoder
        if (electedTranscoder == address(0)) throw;

        return jobs.newJob(_streamId, _transcodingOptions, _maxPricePerSegment, electedTranscoder);
    }

    /*
     * @dev End a job. Can be called by either a broadcaster or transcoder of a job
     * @param _jobId Job identifier
     */
    function endJob(uint256 _jobId) returns (bool) {
        return jobs.endJob(_jobId, jobEndingPeriod);
    }

    /*
     * @dev Submit transcode claims for a range of segments
     * @param _jobId Job identifier
     * @param _startSegmentSequenceNumber First segment in the range of transcoded segments
     * @param _endSegmentSequenceNumber Second segment in the range of transcoded segments
     * @param _transcodeClaimRoot Merkle root of transcode claims for the range of segments
     */
    function claimWork(uint256 _jobId, uint256 _startSegmentSequenceNumber, uint256 _endSegmentSequenceNumber, bytes32 _transcodeClaimsRoot) returns (bool) {
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
    function verify(uint256 _jobId, uint256 _segmentSequenceNumber, bytes32 _dataHash, bytes32 _transcodedDataHash, bytes _broadcasterSig, bytes _proof) returns (bool) {
        if (!jobs.validateTranscoderClaim(_jobId, _segmentSequenceNumber, _dataHash, _transcodedDataHash, _broadcasterSig, _proof, verificationRate)) throw;

        // TODO: Invoke transcoding verification process

        return true;
    }
}
