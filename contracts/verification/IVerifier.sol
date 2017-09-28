pragma solidity ^0.4.13;


/**
 * @title Interface for a Verifier. Can be backed by any implementaiton including oracles or Truebit
 */
contract IVerifier {
    function verify(
        uint256 _jobId,
        uint256 _claimId,
        uint256 _segmentNumber,
        string _transcodingOptions,
        string _dataStorageHash,
        bytes32 _transcodedDataHash
    ) external payable returns (bool);

    function getPrice() public constant returns (uint256);
}
