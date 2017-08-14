pragma solidity ^0.4.11;

/*
 * @title Interface for verifier contract. Can be backed by any implementation including oracles or Truebit
 * TODO: switch to interface type
 */
contract Verifier {
    // External functions
    function verify(
        uint256 _jobId,
        uint256 _claimId,
        uint256 _segmentNumber,
        string _dataHash,
        string _transcodedDataHash,
        address _callbackContract
    ) external payable returns (bool);
}
