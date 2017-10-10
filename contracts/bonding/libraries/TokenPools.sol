pragma solidity ^0.4.13;

import "zeppelin-solidity/contracts/math/SafeMath.sol";


library TokenPools {
    using SafeMath for uint256;

    // Represents rewards and fees to be distributed to delegators
    struct Data {
        uint256 rewardPool;      // Reward tokens in the pool. (totalStake - stakeUsed) / totalStake = % of claimable rewards in the pool
        uint256 feePool;         // Fee tokens in the pool. (totalStake - stakeUsed) / totalStake = % of claimable fees in the pool
        uint256 totalStake;      // Transcoder's total stake during the pool's round
        uint256 usedStake;       // Staked used to claim from fee and reward pools
        uint8 blockRewardCut;    // Block reward cut for the reward pool
        uint8 feeShare;          // Fee share for the fee pool
        bool transcoderClaimed;  // Tracks if a transcoder claimed its share
    }

    function addClaimableFees(TokenPools.Data storage tokenPools, uint256 _fees) internal returns (uint256) {
        uint256 delegatorsFeeShare = _fees.mul(tokenPools.feeShare).div(100);
        uint256 transcoderFeeShare = _fees.sub(delegatorsFeeShare);
        uint256 claimableDelegatorFees = delegatorsFeeShare.mul(tokenPools.totalStake.sub(tokenPools.usedStake)).div(tokenPools.totalStake);
        uint256 claimableFees = claimableDelegatorFees.add(transcoderFeeShare);
        tokenPools.feePool = tokenPools.feePool.add(claimableFees);

        return claimableFees;
    }

    function addClaimableRewards(TokenPools.Data storage tokenPools, uint256 _rewards) internal returns (uint256) {
        uint256 transcoderRewardShare = _rewards.mul(tokenPools.blockRewardCut).div(100);
        uint256 delegatorsRewardShare = _rewards.sub(transcoderRewardShare);
        uint256 claimableDelegatorRewards = delegatorsRewardShare.mul(tokenPools.totalStake.sub(tokenPools.usedStake)).div(tokenPools.totalStake);
        uint256 claimableRewards = claimableDelegatorRewards.add(transcoderRewardShare);
        tokenPools.rewardPool = tokenPools.rewardPool.add(claimableRewards);

        return claimableRewards;
    }

    function transcoderFeePoolShare(TokenPools.Data storage tokenPools, uint256 _stake) internal constant returns (uint256) {
        uint256 delegatorFees = delegatorFeePoolShare(tokenPools, _stake);
        return delegatorFees.add(tokenPools.feePool.mul(uint256(100).sub(tokenPools.feeShare)).div(100));
    }

    function delegatorFeePoolShare(TokenPools.Data storage tokenPools, uint256 _stake) internal constant returns (uint256) {
        if (tokenPools.feePool == 0) {
            return 0;
        } else {
            if (tokenPools.transcoderClaimed) {
                return tokenPools.feePool.mul(_stake).div(tokenPools.totalStake.sub(tokenPools.usedStake));
            } else {
                uint256 delegatorFees = tokenPools.feePool.mul(tokenPools.feeShare).div(100);
                return delegatorFees.mul(_stake).div(tokenPools.totalStake.sub(tokenPools.usedStake));
            }
        }
    }

    function transcoderRewardPoolShare(TokenPools.Data storage tokenPools, uint256 _stake) internal constant returns (uint256) {
        uint256 delegatorRewards = delegatorRewardPoolShare(tokenPools, _stake);
        return delegatorRewards.add(tokenPools.rewardPool.mul(tokenPools.blockRewardCut).div(100));
    }

    function delegatorRewardPoolShare(TokenPools.Data storage tokenPools, uint256 _stake) internal constant returns (uint256) {
        if (tokenPools.rewardPool == 0) {
            return 0;
        } else {
            if (tokenPools.transcoderClaimed) {
                return tokenPools.rewardPool.mul(_stake).div(tokenPools.totalStake.sub(tokenPools.usedStake));
            } else {
                uint256 delegatorRewards = tokenPools.rewardPool.mul(uint256(100).sub(tokenPools.blockRewardCut)).div(100);
                return delegatorRewards.mul(_stake).div(tokenPools.totalStake.sub(tokenPools.usedStake));
            }
        }
    }
}
