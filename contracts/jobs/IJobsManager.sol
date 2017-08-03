pragma solidity ^0.4.11;

/*
 * @title Interface for JobsManager
 * TODO: switch to interface type
 */
contract IJobsManager {
    // External functions
    function job(string _streamId, string _transcodingOptions, uint256 _maxPricePerSegment, uint256 _deposit) external returns (bool);
    function endJob(uint256 _jobId) external returns (bool);
    function claimWork(uint256 _jobId, uint256[2] _segmentRange, bytes32 _transcodeClaimsRoot) external returns (bool);
    function verify(uint256 _jobId, uint256 _claimId, uint256 _segmentNumber, string _dataHash, string _transcodedDataHash, bytes _broadcasterSig, bytes _proof) payable external returns (bool);
    function distributeFees(uint256 _jobId, uint256 _claimId) external returns (bool);
    function batchDistributeFees(uint256 _jobId, uint256 _claimId) external returns (bool);
}
