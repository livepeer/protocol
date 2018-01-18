pragma solidity ^0.4.17;


/*
 * @title Interface for contract that receives verification results
 * TODO: switch to interface type
 */
contract IVerifiable {
    // External functions
    function receiveVerification(uint256 _jobId, uint256 _claimId, uint256 _segmentNumber, bool _result) external;
}
