pragma solidity ^0.4.11;

import "./Verifier.sol";
import "./Verifiable.sol";

/*
 * @title Verifier contract that always returns true
 */
contract IdentityVerifier is Verifier {
    /*
     * @dev Verify implementation that always returns true. Used primarily for testing purposes
     * @param _jobId Job identifier
     * @param _segmentNumber Segment being verified for job
     * @param _code Content-addressed storage hash of binary to execute off-chain
     * @param _dataHash Content-addressed storage hash of input data of segment
     * @param _transcodedDataHash Hash of transcoded segment data
     * @param _callbackContract Address of Verifiable contract to call back
     */
    function verify(uint256 _jobId, uint256 _segmentNumber, string _code, string _dataHash, string _transcodedDataHash, address _callbackContract) payable external returns (bool) {
        // Check if receiveVerification on callback contract succeeded
        if (!Verifiable(_callbackContract).receiveVerification(_jobId, _segmentNumber, true)) throw;

        return true;
    }
}
