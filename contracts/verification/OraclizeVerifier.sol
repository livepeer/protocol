pragma solidity ^0.4.11;

import "./Verifier.sol";
import "./Verifiable.sol";

import "../../installed_contracts/oraclize/contracts/usingOraclize.sol";

/*
 * @title Verifier contract that uses Oraclize for off-chain computation
 */
contract OraclizeVerifier is Verifier, usingOraclize {

    // Stores parameters for an Oraclize query
    struct OraclizeQuery {
        uint256 jobId;
        uint256 segmentSequenceNumber;
        address callbackContract;
    }

    // Stores active Oraclize queries
    mapping (bytes32 => OraclizeQuery) oraclizeQueries;

    // Check if sender is Oraclize
    modifier onlyOraclize() {
        if (msg.sender != oraclize_cbAddress()) throw;
        _;
    }

    // Check if sufficient funds for Oraclize computation
    modifier sufficientOraclizeFunds() {
        if (oraclize_getPrice("computation") > this.balance) throw;
        _;
    }

    function OraclizeVerifier() {
        // OAR used for testing purposes
        OAR = OraclizeAddrResolverI(0x6f485C8BF6fc43eA212E93BBF8ce046C7f1cb475);
        // Set Oraclize proof
        oraclize_setProof(proofType_TLSNotary | proofStorage_IPFS);
    }

    event OraclizeCallback(uint256 indexed jobId, uint256 indexed segmentSequenceNumber, bytes proof, bool result);

    /*
     * @dev Verify implementation that creates an Oraclize computation query
     * @param _jobId Job identifier
     * @param _segmentSequenceNumber Segment being verified for job
     * @param _code Content-addressed storage hash of binary to execute off-chain
     * @param _dataHash Content-addressed storage hash of input data of segment
     * @param _transcodedDataHash Content-addressed storage hash of transcoded input data of segment
     * @param _callbackContract Address of Verifiable contract to call back
     */
    function verify(uint256 _jobId, uint256 _segmentSequenceNumber, string _code, string _dataHash, string _transcodedDataHash, address _callbackContract) payable sufficientOraclizeFunds external returns (bool) {
        // Create Oraclize query
        bytes32 queryId = oraclize_query("computation", [_code, _dataHash, _transcodedDataHash], 3000000);

        // Store Oraclize query parameters
        oraclizeQueries[queryId].jobId = _jobId;
        oraclizeQueries[queryId].segmentSequenceNumber = _segmentSequenceNumber;
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
        if (strCompare("true", _result) == 0) {
            // Notify callback contract of successful verification
            if (!Verifiable(oc.callbackContract).receiveVerification(oc.jobId, oc.segmentSequenceNumber, true)) throw;
            OraclizeCallback(oc.jobId, oc.segmentSequenceNumber, _proof, true);
        } else {
            // Notify callback contract of failed verification
            if (!Verifiable(oc.callbackContract).receiveVerification(oc.jobId, oc.segmentSequenceNumber, false)) throw;
            OraclizeCallback(oc.jobId, oc.segmentSequenceNumber, _proof, false);
        }

        // Remove Oraclize query
        delete oraclizeQueries[_queryId];
    }
}
