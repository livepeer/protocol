pragma solidity ^0.4.17;

import "../Manager.sol";
import "./IVerifier.sol";
import "./IVerifiable.sol";


contract LivepeerVerifier is Manager, IVerifier {
    // IPFS hash of verification computation archive
    string public verificationCodeHash;

    struct Request {
        uint256 jobId;
        uint256 claimId;
        uint256 segmentNumber;
        bytes32 commitHash;
    }

    mapping (uint256 => Request) public requests;
    uint256 public requestCount;

    event VerifyRequest(uint256 indexed requestId, uint256 indexed jobId, uint256 indexed claimId, uint256 segmentNumber, string transcodingOptions, string dataStorageHash, bytes32 dataHash, bytes32 transcodedDataHash);
    event Callback(uint256 indexed requestId, uint256 indexed jobId, uint256 indexed claimId, uint256 segmentNumber, bool result);

    function LivepeerVerifier(address _controller, string _verificationCodeHash) Manager(_controller) {
        // Set verification code hash
        verificationCodeHash = _verificationCodeHash;
    }

    function setParameters(string _verificationCodeHash) external onlyAuthorized {
        verificationCodeHash = _verificationCodeHash;
    }

    /*
     * @dev Fire VerifyRequest event which solvers should listen for to retrieve verification parameters
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
        payable
        onlyAuthorized
        whenSystemNotPaused
        returns (bool)
    {
        // Store request parameters
        requests[requestCount].jobId = _jobId;
        requests[requestCount].claimId = _claimId;
        requests[requestCount].segmentNumber = _segmentNumber;
        requests[requestCount].commitHash = keccak256(_dataHashes[0], _dataHashes[1]);

        VerifyRequest(requestCount, _jobId, _claimId, _segmentNumber, _transcodingOptions, _dataStorageHash, _dataHashes[0], _dataHashes[1]);

        // Update request count
        requestCount++;

        return true;
    }

    /*
     * @dev Callback function invoked by a solver to submit the result of a verification computation
     * @param _requestId Request identifier
     * @param _result Result of verification computation - keccak256 hash of transcoded segment data
     */
    function __callback(uint256 _requestId, bytes32 _result) external onlyAuthorized whenSystemNotPaused returns (bool) {
        Request memory q = requests[_requestId];

        // Check if transcoded data hash returned by solver matches originally submitted transcoded data hash
        if (q.commitHash == _result) {
            IVerifiable(controller.getContract(keccak256("JobsManager"))).receiveVerification(q.jobId, q.claimId, q.segmentNumber, true);
            Callback(_requestId, q.jobId, q.claimId, q.segmentNumber, true);
        } else {
            IVerifiable(controller.getContract(keccak256("JobsManager"))).receiveVerification(q.jobId, q.claimId, q.segmentNumber, false);
            Callback(_requestId, q.jobId, q.claimId, q.segmentNumber, false);
        }

        // Remove request
        delete requests[_requestId];

        return true;
    }

    /*
     * @dev Return price of verification which is zero for this implementation
     */
    function getPrice() public view returns (uint256) {
        return 0;
    }
}
