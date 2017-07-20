pragma solidity ^0.4.11;

/*
 * @title Interface for JobsManager
 * TODO: switch to interface type
 */
contract IJobsManager {
    // External functions
    function job(string _streamId, string _transcodingOptions, uint256 _maxPricePerSegment) external returns (bool);
    function endJob(uint256 _jobId) external returns (bool);
    function claimWork(uint256 _jobId, uint256 _startSegmentSequenceNumber, uint256 _endSegmentSequenceNumber, bytes32 _transcodeClaimsRoot) external returns (bool);
    function verify(uint256 _jobId, uint256 _segmentSequenceNumber, bytes32 _dataHash, bytes32 _transcodedDataHash, bytes _broadcasterSig, bytes _proof) external returns (bool);
}
