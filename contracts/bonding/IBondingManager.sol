pragma solidity ^0.5.11;


/**
 * @title Interface for BondingManager
 * TODO: switch to interface type
 */
contract IBondingManager {
    // The various states a transcoder can be in
    enum TranscoderStatus { NotRegistered, Registered }
    
    event TranscoderUpdate(address indexed transcoder, uint256 rewardCut, uint256 feeShare);
    event TranscoderActivated(address indexed transcoder, uint256 activationRound);
    event TranscoderDeactivated(address indexed transcoder, uint256 deactivationRound);
    event TranscoderSlashed(address indexed transcoder, address finder, uint256 penalty, uint256 finderReward);
    event Reward(address indexed transcoder, uint256 amount);
    event Bond(address indexed newDelegate, address indexed oldDelegate, address indexed delegator, uint256 additionalAmount, uint256 bondedAmount);
    event Unbond(address indexed delegate, address indexed delegator, uint256 unbondingLockId, uint256 amount, uint256 withdrawRound);
    event Rebond(address indexed delegate, address indexed delegator, uint256 unbondingLockId, uint256 amount);
    event WithdrawStake(address indexed delegator, uint256 unbondingLockId, uint256 amount, uint256 withdrawRound);
    event WithdrawFees(address indexed delegator);
    event EarningsClaimed(address indexed delegate, address indexed delegator, uint256 rewards, uint256 fees, uint256 startRound, uint256 endRound);

    // Deprecated events
    // These event signatures can be used to construct the appropriate topic hashes to filter for past logs corresponding
    // to these deprecated events.
    // event Bond(address indexed delegate, address indexed delegator);
    // event Unbond(address indexed delegate, address indexed delegator);
    // event WithdrawStake(address indexed delegator);
    // event TranscoderUpdate(address indexed transcoder, uint256 pendingRewardCut, uint256 pendingFeeShare, uint256 pendingPricePerSegment, bool registered);
    // event TranscoderEvicted(address indexed transcoder);
    // event TranscoderResigned(address indexed transcoder);

    // External functions
    function updateTranscoderWithFees(address _transcoder, uint256 _fees, uint256 _round) external;
    function slashTranscoder(address _transcoder, address _finder, uint256 _slashAmount, uint256 _finderFee) external;
    function setCurrentRoundTotalActiveStake() external;

    // Public functions
    function getTranscoder(
        address _transcoder
    )
        public
        view
        returns (
            uint256 lastRewardRound,
            uint256 rewardCut,
            uint256 feeShare,
            uint256 lastActiveStakeUpdateRound,
            uint256 activationRound,
            uint256 deactivationRound,
            uint256 activeCumulativeRewards,
            uint256 cumulativeRewards,
            uint256 cumulativeFees,
            uint256 lastFeeRound
        );
    
    function getTranscoderEarningsPoolForRound(
        address _transcoder,
        uint256 _round
    )
        public
        view
        returns (
            uint256 rewardPool,
            uint256 feePool,
            uint256 totalStake,
            uint256 claimableStake,
            uint256 transcoderRewardCut,
            uint256 transcoderFeeShare,
            uint256 transcoderRewardPool,
            uint256 transcoderFeePool,
            bool hasTranscoderRewardFeePool,
            uint256 cumulativeRewardFactor,
            uint256 cumulativeFeeFactor
        );
    
    function getFirstTranscoderInPool() public view returns (address);
    function getNextTranscoderInPool(address _transcoder) public view returns (address);
    function transcoderStatus(address _transcoder) public view returns (TranscoderStatus);
    function getTranscoderPoolSize() public view returns (uint256);
    function transcoderTotalStake(address _transcoder) public view returns (uint256);
    function isActiveTranscoder(address _transcoder) public view returns (bool);
    function getTotalBonded() public view returns (uint256);
}
