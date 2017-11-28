pragma solidity ^0.4.17;


/*
 * @title Interface for BondingManager
 * TODO: switch to interface type
 */
contract IBondingManager {
    // External functions
    function setActiveTranscoders() external returns (bool);
    function updateTranscoderWithFees(address _transcoder, uint256 _fees, uint256 _round) external returns (bool);
    function slashTranscoder(address _transcoder, address _finder, uint64 _slashAmount, uint64 _finderFee) external returns (bool);
    function electActiveTranscoder(uint256 _maxPricePerSegment, uint256 _block, uint256 _round) external view returns (address);

    // Public functions
    function transcoderTotalStake(address _transcoder) public view returns (uint256);
    function activeTranscoderTotalStake(address _transcoder, uint256 _round) public view returns (uint256);
}
