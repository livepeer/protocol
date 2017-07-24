pragma solidity ^0.4.11;

/*
 * @title Interface for verifier contract. Can be backed by any implementation including oracles or Truebit
 * TODO: switch to interface type
 */
contract Verifier {
    // External functions
    function verify(uint256 _jobId, uint256 _segmentSequenceNumber, bytes32 _code, bytes32 _transcodedDataHash, address _callbackContract) external returns (bool);
}
