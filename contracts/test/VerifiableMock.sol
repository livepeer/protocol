pragma solidity ^0.4.13;

import "../verification/IVerifiable.sol";


contract VerifiableMock is IVerifiable {
    function receiveVerification(uint256 _jobId, uint256 _segmentSequenceNumber, bool _result) external returns (bool) {
        // Stubbed for tests
        return true;
    }
}
