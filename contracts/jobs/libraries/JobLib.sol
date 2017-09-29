pragma solidity ^0.4.13;

import "zeppelin-solidity/contracts/ECRecovery.sol";
import "zeppelin-solidity/contracts/MerkleProof.sol";
import "zeppelin-solidity/contracts/math/SafeMath.sol";


library JobLib {
    using SafeMath for uint256;
    // Prefix hashed with message hash when a signature is produced by the eth_sign RPC call
    string constant PERSONAL_HASH_PREFIX = "\u0019Ethereum Signed Message:\n32";
    // # of bytes used to store a video profile identifier as a utf8 encoded string
    // Video profile identifier is currently stored as bytes4(keccak256(PROFILE_NAME))
    // We use 2 * 4 = 8 bytes because we store the bytes in a utf8 encoded string so
    // the identifiers can be easily parsed off-chain
    uint8 constant VIDEO_PROFILE_SIZE = 8;

    /*
     * @dev Computes the amount of fees given total segments, total number of profiles and price per segment
     * @param _totalSegments # of segments
     * @param _transcodingOptions String containing video profiles for a job
     * @param _pricePerSegment Price in LPT base units per segment
     */
    function calcFees(uint256 _totalSegments, string _transcodingOptions, uint256 _pricePerSegment) public constant returns (uint256) {
        // Calculate total profiles defined in the transcoding options string
        uint256 totalProfiles = bytes(_transcodingOptions).length.div(VIDEO_PROFILE_SIZE);
        return _totalSegments.mul(totalProfiles).mul(_pricePerSegment);
    }

    /*
     * Computes whether a segment is eligible for verification based on the last call to claimWork()
     * @param _segmentSequenceNumber Sequence number of segment in stream
     * @param _startSegmentSequenceNumber Sequence number of first segment claimed
     * @param _endSegmentSequenceNumber Sequence number of last segment claimed
     * @param _lastClaimedWorkBlock Block number when claimWork() was last called
     * @param _lastClaimedWorkBlockHash Block hash when claimWork() was last called
     * @param _verificationRate Rate at which a particular segment should be verified
     */
    function shouldVerifySegment(
        uint256 _segmentNumber,
        uint256[2] _segmentRange,
        uint256 _claimBlock,
        uint64 _verificationRate
    )
        public
        constant
        returns (bool)
    {
        // Segment must be in segment range
        if (_segmentNumber < _segmentRange[0] || _segmentNumber > _segmentRange[1]) {
            return false;
        }

        if (uint256(keccak256(_claimBlock, block.blockhash(_claimBlock), _segmentNumber)) % _verificationRate == 0) {
            return true;
        } else {
            return false;
        }
    }

    function validateBroadcasterSig(
        string _streamId,
        uint256 _segmentNumber,
        bytes32 _dataHash,
        bytes _broadcasterSig,
        address _broadcaster
    )
        public
        constant
        returns (bool)
    {
        return ECRecovery.recover(personalSegmentHash(_streamId, _segmentNumber, _dataHash), _broadcasterSig) == _broadcaster;
    }

    function validateReceipt(
        string _streamId,
        uint256 _segmentNumber,
        bytes32 _dataHash,
        bytes32 _transcodedDataHash,
        bytes _broadcasterSig,
        bytes _proof,
        bytes32 _claimRoot
    )
        public
        constant
        returns (bool)
    {
        return MerkleProof.verifyProof(_proof, _claimRoot, transcodeReceiptHash(_streamId, _segmentNumber, _dataHash, _transcodedDataHash, _broadcasterSig));
    }

    /*
     * Compute the hash of a segment
     * @param _streamId Stream identifier
     * @param _segmentSequenceNumber Segment sequence number in stream
     * @param _dataHash Content-addressed storage hash of segment data
     */
    function segmentHash(string _streamId, uint256 _segmentNumber, bytes32 _dataHash) public constant returns (bytes32) {
        return keccak256(_streamId, _segmentNumber, _dataHash);
    }

    /*
     * @dev Compute the personal segment hash of a segment. Hashes the concatentation of the personal hash prefix and the segment hash
     * @param _streamId Stream identifier
     * @param _segmentSequenceNumber Segment sequence number in stream
     * @param _dataHash Content-addrssed storage hash of segment data
     */
    function personalSegmentHash(string _streamId, uint256 _segmentNumber, bytes32 _dataHash) public constant returns (bytes32) {
        bytes memory prefixBytes = bytes(PERSONAL_HASH_PREFIX);

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
    function transcodeReceiptHash(
        string _streamId,
        uint256 _segmentNumber,
        bytes32 _dataHash,
        bytes32 _transcodedDataHash,
        bytes _broadcasterSig
    )
        public
        constant
        returns (bytes32)
    {
        return keccak256(_streamId, _segmentNumber, _dataHash, _transcodedDataHash, _broadcasterSig);
    }
}
