pragma solidity ^0.4.11;

/*
 * @title Interface for BondingManager
 * TODO: switch to interface type
 */
contract IBondingManager {
    function transcoder(uint8 _blockRewardCut, uint8 _feeShare, uint256 _pricePerSegment) returns (bool);
    function resignAsTranscoder() returns (bool);
    function bond(uint _amount, address _to) returns (bool);
    function unbond() returns (bool);
    function withdraw() returns (bool);
    function reward() returns (bool);
    function electActiveTranscoder(uint256 _maxPricePerSegment) constant returns (address);
    function setActiveTranscoders() returns (bool);
    function activeTranscoderTotalStake(address _transcoder) constant returns (uint256);
    function transcoderTotalStake(address _transcoder) constant returns (uint256);
    function delegatorStake(address _delegator) constant returns (uint256);
}
