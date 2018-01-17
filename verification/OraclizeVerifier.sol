pragma solidity ^0.4.17;

import "../Manager.sol";
import "./IVerifier.sol";
import "./IVerifiable.sol";

import "zeppelin-solidity/contracts/math/SafeMath.sol";
import "../../installed_contracts/oraclize/contracts/usingOraclize.sol";


/*
 * @title Verifier contract that uses Oraclize for off-chain computation
 */
contract OraclizeVerifier is Manager, usingOraclize, IVerifier {
    using SafeMath for uint256;

    string public verificationCodeHash;
    uint256 public gasPrice;
    uint256 public gasLimit;

    // Stores parameters for an Oraclize query
    struct OraclizeQuery {
        uint256 jobId;
        uint256 claimId;
        uint256 segmentNumber;
        bytes32 commitHash;
    }

    // Stores active Oraclize queries
    mapping (bytes32 => OraclizeQuery) oraclizeQueries;

    // Check if sender is JobsManager
    modifier onlyJobsManager() {
        require(msg.sender == controller.getContract(keccak256("JobsManager")));
        _;
    }

    // Check if sender is Oraclize
    modifier onlyOraclize() {
        require(msg.sender == oraclize_cbAddress());
        _;
    }

    // Check if sufficient funds for Oraclize computation
    modifier sufficientPayment() {
        require(getPrice() <= msg.value);
        _;
    }

    event OraclizeCallback(uint256 indexed jobId, uint256 indexed claimId, uint256 indexed segmentNumber, bytes proof, bool result);

    function OraclizeVerifier(address _controller, string _verificationCodeHash, uint256 _gasPrice, uint256 _gasLimit) public Manager(_controller) {
        // Set verification code hash
        verificationCodeHash = _verificationCodeHash;
        // Set callback gas price
        gasPrice = _gasPrice;
        oraclize_setCustomGasPrice(_gasPrice);
        // Set callback gas limit
        gasLimit = _gasLimit;
        // Set Oraclize proof type
        oraclize_setProof(proofType_TLSNotary | proofStorage_IPFS);
    }

    function setVerificationCodeHash(string _verificationCodeHash) external onlyControllerOwner {
        verificationCodeHash = _verificationCodeHash;
    }

    /*
     * @dev Verify implementation that creates an Oraclize computation query
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
        payable
        onlyJobsManager
        whenSystemNotPaused
        sufficientPayment
    {
        // Create Oraclize query
        string memory codeHashQuery = strConcat("binary(", verificationCodeHash, ").unhexlify()");
        bytes32 queryId = oraclize_query("computation", [codeHashQuery, _dataStorageHash, _transcodingOptions], gasLimit);

        // Store Oraclize query parameters
        oraclizeQueries[queryId].jobId = _jobId;
        oraclizeQueries[queryId].claimId = _claimId;
        oraclizeQueries[queryId].segmentNumber = _segmentNumber;
        oraclizeQueries[queryId].commitHash = keccak256(_dataHashes[0], _dataHashes[1]);
    }

    /*
     * @dev Callback function invoked by Oraclize to return result of off-chain computation
     * @param _queryId Oraclize query identifier
     * @param _result Result of Oraclize computation
     */
    // solium-disable-next-line mixedcase
    function __callback(bytes32 _queryId, string _result, bytes _proof) public onlyOraclize whenSystemNotPaused {
        OraclizeQuery memory oc = oraclizeQueries[_queryId];

        // Check if hash returned by Oraclize matches originally submitted commit hash = h(dataHash, transcodedDataHash)
        if (oc.commitHash == strToBytes32(_result)) {
            // Notify callback contract of successful verification
            IVerifiable(controller.getContract(keccak256("JobsManager"))).receiveVerification(oc.jobId, oc.claimId, oc.segmentNumber, true);
            OraclizeCallback(oc.jobId, oc.claimId, oc.segmentNumber, _proof, true);
        } else {
            // Notify callback contract of failed verification
            IVerifiable(controller.getContract(keccak256("JobsManager"))).receiveVerification(oc.jobId, oc.claimId, oc.segmentNumber, false);
            OraclizeCallback(oc.jobId, oc.claimId, oc.segmentNumber, _proof, false);
        }

        // Remove Oraclize query
        delete oraclizeQueries[_queryId];
    }

    /*
     * @dev Return price of Oraclize verification
     */
    function getPrice() public view returns (uint256) {
        return oraclize_getPrice("computation").add(gasPrice.mul(gasLimit));
    }

    /*
     * @dev Convert a string representing a 32 byte array into a 32 byte array
     * @param _str String representing a 32 byte array
     */
    function strToBytes32(string _str) internal pure returns (bytes32) {
        bytes memory byteStr = bytes(_str);
        bytes32 result;

        assembly {
            result := mload(add(byteStr, 32))
        }

        return result;
    }
}
