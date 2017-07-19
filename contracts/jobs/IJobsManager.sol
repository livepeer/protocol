pragma solidity ^0.4.11;

/*
 * @title Interface for JobsManager
 * TODO: switch to interface type
 */
contract IJobsManager {
    function job(string _streamId, string _transcodingOptions, uint256 _maxPricePerSegment) returns (bool);
    function endJob(uint256 _jobId) returns (bool);
    function claimWork(uint256 _jobId, uint256 _startSegmentSequenceNumber, uint256 _endSegmentSequenceNumber, bytes32 _transcodeClaimsRoot) returns (bool);
    function verify(uint256 _jobId, uint256 _segmentSequenceNumber, bytes32 _dataHash, bytes32 _transcodedDataHash, bytes _broadcasterSig, bytes _proof) returns (bool);
}
