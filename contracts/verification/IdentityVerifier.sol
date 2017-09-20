pragma solidity ^0.4.13;

import "../Manager.sol";
import "./IVerifier.sol";
import "./IVerifiable.sol";


/*
 * @title Verifier contract that always returns true
 */
contract IdentityVerifier is Manager, IVerifier {
    // Check that sender is JobsManager
    modifier onlyJobsManager() {
        require(msg.sender == controller.getContract(keccak256("JobsManager")));
        _;
    }

    function IdentityVerifier(address _controller) Manager(_controller) {}

    /*
     * @dev Verify implementation that always returns true. Used primarily for testing purposes
     * @param _jobId Job identifier
     * @param _segmentNumber Segment being verified for job
     * @param _code Content-addressed storage hash of binary to execute off-chain
     * @param _dataHash Content-addressed storage hash of input data of segment
     * @param _transcodedDataHash Hash of transcoded segment data
     * @param _callbackContract Address of Verifiable contract to call back
     */
    function verify(
        uint256 _jobId,
        uint256 _claimId,
        uint256 _segmentNumber,
        string _dataHash,
        string _transcodedDataHash,
        address _callbackContract
    )
        external
        onlyJobsManager
        payable
        returns (bool)
    {
        // Check if receiveVerification on callback contract succeeded
        IVerifiable verifiableContract = IVerifiable(_callbackContract);
        verifiableContract.receiveVerification(_jobId, _claimId, _segmentNumber, true);

        return true;
    }
}
