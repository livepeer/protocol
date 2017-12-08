pragma solidity ^0.4.17;


/*
 * @title Interface for JobsManager
 * TODO: switch to interface type
 */
contract IJobsManager {
    event Deposit(address indexed broadcaster, uint256 amount);
    event Withdraw(address indexed broadcaster);
    event NewJob(address indexed broadcaster, uint256 jobId, string streamId, string transcodingOptions, uint256 maxPricePerSegment, uint256 creationBlock);
    event NewClaim(address indexed transcoder, uint256 indexed jobId, uint256 claimId);
    event Verify(address indexed transcoder, uint256 indexed jobId, uint256 indexed claimId, uint256 segmentNumber);
    event DistributeFees(address indexed transcoder, uint256 indexed jobId, uint256 indexed claimId, uint256 fees);
    event PassedVerification(address indexed transcoder, uint256 indexed jobId, uint256 indexed claimId, uint256 segmentNumber);
    event FailedVerification(address indexed transcoder, uint256 indexed jobId, uint256 indexed claimId, uint256 segmentNumber);
}
