pragma solidity ^0.4.17;


/*
 * @title Interface for BondingManager
 * TODO: switch to interface type
 */
contract IBondingManager {
    event TranscoderUpdate(address transcoder, uint256 pendingBlockRewardCut, uint256 pendingFeeShare, uint256 pendingPricePerSegment, uint256 round);
    event TranscoderEvicted(address transcoder, uint256 round);
    event TranscoderResigned(address transcoder, uint256 round);
    event TranscoderSlashed(address transcoder, uint256 penalty, uint256 round);
    event Reward(address transcoder, uint256 amount, uint256 round);
    event Bond(address indexed delegate, address indexed delegator, uint256 round);
    event Unbond(address indexed delegate, address indexed delegator, uint256 round);

    // External functions
    function setActiveTranscoders() external;
    function updateTranscoderWithFees(address _transcoder, uint256 _fees, uint256 _round) external;
    function slashTranscoder(address _transcoder, address _finder, uint256 _slashAmount, uint256 _finderFee) external;
    function electActiveTranscoder(uint256 _maxPricePerSegment, uint256 _block, uint256 _round) external view returns (address);

    // Public functions
    function transcoderTotalStake(address _transcoder) public view returns (uint256);
    function activeTranscoderTotalStake(address _transcoder, uint256 _round) public view returns (uint256);
    function getTotalBonded() public view returns (uint256);
}
