pragma solidity ^0.4.17;


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
        bytes32[2] _dataHashes
    )
        external
        payable;

    function getPrice() public view returns (uint256);
}
