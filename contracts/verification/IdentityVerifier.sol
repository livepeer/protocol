pragma solidity ^0.4.17;

import "../Manager.sol";
import "./IVerifier.sol";
import "./IVerifiable.sol";


/*
 * @title Verifier contract that always returns true
 */
contract IdentityVerifier is Manager, IVerifier {
    modifier onlyJobsManager() {
        require(msg.sender == controller.getContract(keccak256("JobsManager")));
        _;
    }

    function IdentityVerifier(address _controller) public Manager(_controller) {}

    /*
     * @dev Verify implementation that always returns true. Used primarily for testing purposes
     * @param _jobId Job identifier
     * @param _segmentNumber Segment being verified for job
     * @param _code Content-addressed storage hash of binary to execute off-chain
     * @param _dataStorageHash Content-addressed storage hash of input data of segment
     * @param _dataHashes Hash of segment data and hash of transcoded segment data
     */
    function verify(
        uint256 _jobId,
        uint256 _claimId,
        uint256 _segmentNumber,
        string _transcodingOptions,
        string _dataStorageHash,
        bytes32[2] _dataHashes
    )
        external
        onlyJobsManager
        whenSystemNotPaused
        payable
    {
        // Check if receiveVerification on callback contract succeeded
        IVerifiable verifiableContract = IVerifiable(msg.sender);
        verifiableContract.receiveVerification(_jobId, _claimId, _segmentNumber, true);
    }

    /*
     * @dev Return price of verification which is zero for this implementation
     */
    function getPrice() public view returns (uint256) {
        return 0;
    }
}
