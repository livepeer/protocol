pragma solidity ^0.4.13;


/*
 * @title Interface for BondingManager
 * TODO: switch to interface type
 */
contract IBondingManager {
    // External functions
    function setActiveTranscoders() external returns (bool);
    function updateTranscoderWithFees(address _transcoder, uint256 _fees, uint256 _round) external returns (bool);
    function slashTranscoder(address _transcoder, address _finder, uint64 _slashAmount, uint64 _finderFee) external returns (bool);
    function electActiveTranscoder(uint256 _maxPricePerSegment) external returns (address);

    // Public functions
    function transcoderTotalStake(address _transcoder) public constant returns (uint256);
    function activeTranscoderTotalStake(address _transcoder) public constant returns (uint256);
}
