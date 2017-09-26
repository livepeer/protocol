pragma solidity ^0.4.13;

import "../verification/IVerifier.sol";
import "../verification/IVerifiable.sol";


contract VerifierMock is IVerifier {
    IVerifiable verifiable;

    uint256 public jobId;
    uint256 public claimId;
    uint256 public segmentNumber;
    bool public result;

    function setVerifiable(address _verifiable) external {
        verifiable = IVerifiable(_verifiable);
    }

    function setVerificationResult(uint256 _jobId, uint256 _claimId, uint256 _segmentNumber, bool _result) external {
        jobId = _jobId;
        claimId = _claimId;
        segmentNumber = _segmentNumber;
        result = _result;
    }

    function callReceiveVerification() external {
        verifiable.receiveVerification(jobId, claimId, segmentNumber, result);
    }

    function verify(
        uint256 _jobId,
        uint256 _claimId,
        uint256 _segmentNumber,
        string _transcodingOptions,
        string _dataStorageHash,
        bytes32 _transcodedDataHash
    )
        external
        payable
        returns (bool)
    {
        return true;
    }

    function getPrice() public constant returns (uint256) {
        return 0;
    }
}
