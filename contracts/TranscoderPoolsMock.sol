pragma solidity ^0.4.8;

import "./TranscoderPools.sol";

contract TranscoderPoolsMock {
    using TranscoderPools for TranscoderPools.TranscoderPools;

    TranscoderPools.TranscoderPools transcoderPools;

    function init(uint256 _activePoolSize, uint256 _candidatePoolSize) {
        transcoderPools.init(_activePoolSize, _candidatePoolSize);
    }

    function activePoolMaxSize() returns (uint256) {
        return transcoderPools.activeTranscoders.maxSize;
    }

    function candidatePoolMaxSize() returns (uint256) {
        return transcoderPools.candidateTranscoders.maxSize;
    }

    function isActiveTranscoder(address _transcoder) constant returns (bool) {
        return transcoderPools.isActiveTranscoder(_transcoder);
    }

    function isCandidateTranscoder(address _transcoder) constant returns (bool) {
        return transcoderPools.isCandidateTranscoder(_transcoder);
    }

    function addTranscoder(address _transcoder, uint256 _bondedAmount) {
        transcoderPools.addTranscoder(_transcoder, _bondedAmount);
    }

    function removeTranscoder(address _transcoder) {
        transcoderPools.removeTranscoder(_transcoder);
    }

    function increaseTranscoderStake(address _transcoder, uint256 _bondedAmount) {
        transcoderPools.increaseTranscoderStake(_transcoder, _bondedAmount);
    }

    function decreaseTranscoderStake(address _transcoder, uint256 _amount) {
        transcoderPools.decreaseTranscoderStake(_transcoder, _amount);
    }
}
