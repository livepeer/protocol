pragma solidity ^0.4.17;

import "../bonding/libraries/TranscoderPool.sol";


contract TranscoderPoolFixture {
    using TranscoderPool for TranscoderPool.Data;

    TranscoderPool.Data pool;

    function setMaxSize(uint256 _size) public {
        pool.setMaxSize(_size);
    }

    function addTranscoder(address _transcoder, uint256 _stake, address _worseTranscoder, address _betterTranscoder) public {
        pool.addTranscoder(_transcoder, _stake, _worseTranscoder, _betterTranscoder);
    }

    function removeTranscoder(address _transcoder) public {
        pool.removeTranscoder(_transcoder);
    }

    function increaseTranscoderStake(address _transcoder, uint256 _amount, address _worseTranscoder, address _betterTranscoder) public {
        pool.increaseTranscoderStake(_transcoder, _amount, _worseTranscoder, _betterTranscoder);
    }

    function decreaseTranscoderStake(address _transcoder, uint256 _amount, address _worseTranscoder, address _betterTranscoder) public {
        pool.decreaseTranscoderStake(_transcoder, _amount, _worseTranscoder, _betterTranscoder);
    }

    function contains(address _transcoder) public view returns (bool) {
        return pool.contains(_transcoder);
    }

    function getSize() public view returns (uint256) {
        return pool.getSize();
    }

    function getMaxSize() public view returns (uint256) {
        return pool.maxSize;
    }

    function getTranscoderStake(address _transcoder) public view returns (uint256) {
        return pool.getTranscoderStake(_transcoder);
    }

    function getWorstTranscoder() public view returns (address) {
        return pool.getWorstTranscoder();
    }

    function getBestTranscoder() public view returns (address) {
        return pool.getBestTranscoder();
    }

    function getNextTranscoder(address _transcoder) public view returns (address) {
        return pool.getNextTranscoder(_transcoder);
    }

    function getPrevTranscoder(address _transcoder) public view returns (address) {
        return pool.getPrevTranscoder(_transcoder);
    }
}
