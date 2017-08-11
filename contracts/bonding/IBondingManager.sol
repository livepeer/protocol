pragma solidity ^0.4.11;

/*
 * @title Interface for BondingManager
 * TODO: switch to interface type
 */
contract IBondingManager {
    // External functions
    function setActiveTranscoders() external returns (bool);
    function updateTranscoderFeePool(address _transcoder, uint256 _fees, uint256 _claimBlock, uint256 _transcoderTotalStake) external returns (bool);
    function slashTranscoder(address _transcoder, address _finder, uint64 _slashAmount, uint64 _finderFee) external returns (bool);
    function electActiveTranscoder(uint256 _maxPricePerSegment) external constant returns (address, uint256);

    // Public functions
    function transcoderTotalStake(address _transcoder) public constant returns (uint256);
}
