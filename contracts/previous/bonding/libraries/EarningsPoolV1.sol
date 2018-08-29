pragma solidity ^0.4.17;

import "../../../libraries/MathUtils.sol";

import "zeppelin-solidity/contracts/math/SafeMath.sol";


library EarningsPoolV1 {
    using SafeMath for uint256;

    // Represents rewards and fees to be distributed to delegators
    struct Data {
        uint256 rewardPool;                // Rewards in the pool
        uint256 feePool;                   // Fees in the pool
        uint256 totalStake;                // Transcoder's total stake during the pool's round
        uint256 claimableStake;            // Stake that can be used to claim portions of the fee and reward pool
        uint256 transcoderRewardCut;       // Reward cut for the reward pool
        uint256 transcoderFeeShare;        // Fee share for the fee pool
    }

    function init(EarningsPoolV1.Data storage earningsPool, uint256 _stake, uint256 _rewardCut, uint256 _feeShare) internal {
        earningsPool.totalStake = _stake;
        earningsPool.claimableStake = _stake;
        earningsPool.transcoderRewardCut = _rewardCut;
        earningsPool.transcoderFeeShare = _feeShare;
    }

    function hasClaimableShares(EarningsPoolV1.Data storage earningsPool) internal view returns (bool) {
        return earningsPool.claimableStake > 0;
    }

    function claimShare(EarningsPoolV1.Data storage earningsPool, uint256 _stake, bool _isTranscoder) internal returns (uint256, uint256) {
        uint256 fees = 0;
        uint256 rewards = 0;

        if (earningsPool.feePool > 0) {
            // Compute fee share
            fees = feePoolShare(earningsPool, _stake, _isTranscoder);
            earningsPool.feePool = earningsPool.feePool.sub(fees);
        }

        if (earningsPool.rewardPool > 0) {
            // Compute reward share
            rewards = rewardPoolShare(earningsPool, _stake, _isTranscoder);
            earningsPool.rewardPool = earningsPool.rewardPool.sub(rewards);
        }

        // Update remaning claimable stake for token pools
        earningsPool.claimableStake = earningsPool.claimableStake.sub(_stake);

        return (fees, rewards);
    }

    function feePoolShare(EarningsPoolV1.Data storage earningsPool, uint256 _stake, bool _isTranscoder) internal view returns (uint256) {
        uint256 transcoderFees = 0;
        uint256 delegatorFees = 0;

        if (earningsPool.claimableStake > 0) {
            uint256 delegatorsFees = MathUtils.percOf(earningsPool.feePool, earningsPool.transcoderFeeShare);
            transcoderFees = earningsPool.feePool.sub(delegatorsFees);
            delegatorFees = MathUtils.percOf(delegatorsFees, _stake, earningsPool.claimableStake);
        }

        if (_isTranscoder) {
            return delegatorFees.add(transcoderFees);
        } else {
            return delegatorFees;
        }
    }

    function rewardPoolShare(EarningsPoolV1.Data storage earningsPool, uint256 _stake, bool _isTranscoder) internal view returns (uint256) {
        uint256 transcoderRewards = 0;
        uint256 delegatorRewards = 0;

        if (earningsPool.claimableStake > 0) {
            transcoderRewards = MathUtils.percOf(earningsPool.rewardPool, earningsPool.transcoderRewardCut);
            delegatorRewards = MathUtils.percOf(earningsPool.rewardPool.sub(transcoderRewards), _stake, earningsPool.claimableStake);
        }

        if (_isTranscoder) {
            return delegatorRewards.add(transcoderRewards);
        } else {
            return delegatorRewards;
        }
    }
}