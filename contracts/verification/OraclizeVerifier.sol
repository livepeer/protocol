pragma solidity ^0.4.11;

import "./Verifier.sol";
import "./Verifiable.sol";

import "../../installed_contracts/oraclize/contracts/usingOraclize.sol";

/*
 * @title Verifier contract that uses Oraclize for off-chain computation
 */
contract OraclizeVerifier is Verifier, usingOraclize {
    string public verificationCodeHash;

    // Stores parameters for an Oraclize query
    struct OraclizeQuery {
        uint256 jobId;
        uint256 claimId;
        uint256 segmentNumber;
        string transcodedDataHash;
        address callbackContract;
    }

    // Stores active Oraclize queries
    mapping (bytes32 => OraclizeQuery) oraclizeQueries;

    // Check if sender is Oraclize
    modifier onlyOraclize() {
        require(msg.sender == oraclize_cbAddress());
        _;
    }

    // Check if sufficient funds for Oraclize computation
    modifier sufficientOraclizeFunds() {
        if (oraclize_getPrice("computation") > msg.value) throw;
        _;
    }

    function OraclizeVerifier() {
        // OAR used for testing purposes
        OAR = OraclizeAddrResolverI(0x6f485C8BF6fc43eA212E93BBF8ce046C7f1cb475);
        // Set Oraclize proof
        oraclize_setProof(proofType_TLSNotary | proofStorage_IPFS);
        // Set verification code hash
        verificationCodeHash = "QmPu23REr93Mfv7m9NPdFLMZz7PzHE1LaXvn4AmQCQgR3u";
    }

    event OraclizeCallback(uint256 indexed jobId, uint256 indexed claimId, uint256 indexed segmentNumber, bytes proof, bool result);

    /*
     * @dev Verify implementation that creates an Oraclize computation query
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
        payable
        sufficientOraclizeFunds
        returns (bool)
    {
        // Create Oraclize query
        string memory mVerificationCodeHash = verificationCodeHash;
        bytes32 queryId = oraclize_query("computation", [mVerificationCodeHash, _dataHash], 3000000);

        // Store Oraclize query parameters
        oraclizeQueries[queryId].jobId = _jobId;
        oraclizeQueries[queryId].claimId = _claimId;
        oraclizeQueries[queryId].segmentNumber = _segmentNumber;
        oraclizeQueries[queryId].transcodedDataHash = _transcodedDataHash;
        oraclizeQueries[queryId].callbackContract = _callbackContract;

        return true;
    }

    /*
     * @dev Callback function invoked by Oraclize to return result of off-chain computation
     * @param _queryId Oraclize query identifier
     * @param _result Result of Oraclize computation
     */
    function __callback(bytes32 _queryId, string _result, bytes _proof) onlyOraclize {
        OraclizeQuery memory oc = oraclizeQueries[_queryId];

        // Check if transcoded data hash returned by Oraclize matches originally submitted transcoded data hash
        if (strCompare(oc.transcodedDataHash, _result) == 0) {
            // Notify callback contract of successful verification
            Verifiable(oc.callbackContract).receiveVerification(oc.jobId, oc.claimId, oc.segmentNumber, true);
            OraclizeCallback(oc.jobId, oc.claimId, oc.segmentNumber, _proof, true);
        } else {
            // Notify callback contract of failed verification
            Verifiable(oc.callbackContract).receiveVerification(oc.jobId, oc.claimId, oc.segmentNumber, false);
            OraclizeCallback(oc.jobId, oc.claimId, oc.segmentNumber, _proof, false);
        }

        // Remove Oraclize query
        delete oraclizeQueries[_queryId];
    }
}
