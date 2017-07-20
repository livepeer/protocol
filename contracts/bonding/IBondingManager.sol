pragma solidity ^0.4.11;

/*
 * @title Interface for BondingManager
 * TODO: switch to interface type
 */
contract IBondingManager {
    // External functions
    function transcoder(uint8 _blockRewardCut, uint8 _feeShare, uint256 _pricePerSegment) external returns (bool);
    function resignAsTranscoder() external returns (bool);
    function bond(uint _amount, address _to) external returns (bool);
    function unbond() external returns (bool);
    function withdraw() external returns (bool);
    function reward() external returns (bool);

    // Public functions
    function setActiveTranscoders() public returns (bool);
    function electActiveTranscoder(uint256 _maxPricePerSegment) public constant returns (address);
    function activeTranscoderTotalStake(address _transcoder) public constant returns (uint256);
    function transcoderTotalStake(address _transcoder) public constant returns (uint256);
    function delegatorStake(address _delegator) public constant returns (uint256);
    function delegatorRewards(address _delegator) public constant returns (uint256);
}
