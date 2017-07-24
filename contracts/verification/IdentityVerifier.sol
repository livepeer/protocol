pragma solidity ^0.4.11;

import "./Verifier.sol";
import "./Verifiable.sol";

contract IdentityVerifier is Verifier {
    function verify(uint256 _jobId, uint256 _segmentSequenceNumber, bytes32 _code, bytes32 _transcodedDataHash, address _callbackContract) external returns (bool) {
        bytes32 result = _transcodedDataHash;

        if (result == _transcodedDataHash) {
            // Check if receiveVerification on callback contract succeeded
            if (!Verifiable(_callbackContract).receiveVerification(_jobId, _segmentSequenceNumber, true)) throw;

            return true;
        } else {
            // Check if receiveVerification on callback contract succeeded
            if (!Verifiable(_callbackContract).receiveVerification(_jobId, _segmentSequenceNumber, false)) throw;

            return false;
        }
    }
}
