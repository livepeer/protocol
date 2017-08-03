pragma solidity ^0.4.11;

import "./ECVerify.sol";
import "./MerkleProof.sol";

library JobLib {
    // Prefix hashed with message hash when a signature is produced by the eth_sign RPC call
    string constant personalHashPrefix = "\u0019Ethereum Signed Message:\n32";

    /*
     * Computes whether a segment is eligible for verification based on the last call to claimWork()
     * @param _segmentSequenceNumber Sequence number of segment in stream
     * @param _startSegmentSequenceNumber Sequence number of first segment claimed
     * @param _endSegmentSequenceNumber Sequence number of last segment claimed
     * @param _lastClaimedWorkBlock Block number when claimWork() was last called
     * @param _lastClaimedWorkBlockHash Block hash when claimWork() was last called
     * @param _verificationRate Rate at which a particular segment should be verified
     */
    function shouldVerifySegment(uint256 _segmentNumber,
                                 uint256[2] _segmentRange,
                                 uint256 _claimBlock,
                                 uint64 _verificationRate) constant returns (bool) {
        // Segment must be in segment range
        if (_segmentNumber < _segmentRane[0] || _segmentNumber > _segmentRange[1]) return false;

        if (uint256(keccak256(_claimBlock, block.blockhash(_claimBlock), _segmentNumber)) % _verificationRate == 0) {
            return true;
        } else {
            return false;
        }
    }

    /*
     * Compute the hash of a segment
     * @param _streamId Stream identifier
     * @param _segmentSequenceNumber Segment sequence number in stream
     * @param _dataHash Content-addressed storage hash of segment data
     */
    function segmentHash(string _streamId, uint256 _segmentNumber, string _dataHash) constant returns (bytes32) {
        return keccak256(_streamId, _segmentNumber, _dataHash);
    }

    /*
     * @dev Compute the personal segment hash of a segment. Hashes the concatentation of the personal hash prefix and the segment hash
     * @param _streamId Stream identifier
     * @param _segmentSequenceNumber Segment sequence number in stream
     * @param _dataHash Content-addrssed storage hash of segment data
     */
    function personalSegmentHash(string _streamId, uint256 _segmentNumber, string _dataHash) public constant returns (bytes32) {
        bytes memory prefixBytes = bytes(personalHashPrefix);

        return keccak256(prefixBytes, segmentHash(_streamId, _segmentNumber, _dataHash));
    }

    /*
     * Compute the hash of a transcode receipt
     * @param _streamId Stream identifier
     * @param _segmentSequenceNumber Segment sequence number in stream
     * @param _dataHash Content-addressed storage hash of segment data
     * @param _transcodedDataHash Content-addressed storage hash of transcoded segment data
     * @param _broadcasterSig Broadcaster's signature over segment
     */
    function transcodeReceiptHash(string _streamId,
                                  uint256 _segmentNumber,
                                  string _dataHash,
                                  string _transcodedDataHash,
                                  bytes _broadcasterSig) public constant returns (bytes32) {
        return keccak256(_streamId, _segmentNumber, _dataHash, _transcodedDataHash, _broadcasterSig);
    }
}
