pragma solidity ^0.4.17;

import "zeppelin-solidity/contracts/math/SafeMath.sol";


library TokenPools {
    using SafeMath for uint256;

    uint256 public constant PERC_DIVISOR = 1000000;

    // Represents rewards and fees to be distributed to delegators
    struct Data {
        uint256 rewardPool;                // Reward tokens in the pool. (totalStake - stakeUsed) / totalStake = % of claimable rewards in the pool
        uint256 feePool;                   // Fee tokens in the pool. (totalStake - stakeUsed) / totalStake = % of claimable fees in the pool
        uint256 totalStake;                // Transcoder's total stake during the pool's round
        uint256 usedStake;                 // Staked used to claim from fee and reward pools
        uint256 transcoderBlockRewardCut;  // Block reward cut for the reward pool
        uint256 transcoderFeeShare;        // Fee share for the fee pool
    }

    function init(TokenPools.Data storage tokenPools, uint256 _stake, uint256 _blockRewardCut, uint256 _feeShare) internal returns (bool) {
        tokenPools.totalStake = _stake;
        tokenPools.transcoderBlockRewardCut = _blockRewardCut;
        tokenPools.transcoderFeeShare = _feeShare;

        return true;
    }

    function unclaimableFees(TokenPools.Data storage tokenPools, uint256 _fees) internal view returns (uint256) {
        if (tokenPools.totalStake == 0) {
            return 0;
        } else {
            uint256 delegatorsFeeShare = _fees.mul(tokenPools.transcoderFeeShare).div(PERC_DIVISOR);
            return delegatorsFeeShare.mul(tokenPools.usedStake).div(tokenPools.totalStake);
        }
    }

    function unclaimableRewards(TokenPools.Data storage tokenPools, uint256 _rewards) internal view returns (uint256) {
        if (tokenPools.totalStake == 0) {
            return 0;
        } else {
            uint256 delegatorsRewardShare = _rewards.mul(PERC_DIVISOR.sub(tokenPools.transcoderBlockRewardCut)).div(PERC_DIVISOR);
            return delegatorsRewardShare.mul(tokenPools.usedStake).div(tokenPools.totalStake);
        }
    }

    function feePoolShare(TokenPools.Data storage tokenPools, uint256 _stake, bool _isTranscoder) internal view returns (uint256) {
        uint256 transcoderFees = 0;
        uint256 delegatorFees = 0;

        if (tokenPools.totalStake > 0) {
            transcoderFees = tokenPools.feePool.mul(PERC_DIVISOR.sub(tokenPools.transcoderFeeShare)).div(PERC_DIVISOR);
            delegatorFees = tokenPools.feePool.sub(transcoderFees).mul(_stake).div(tokenPools.totalStake);
        }

        if (_isTranscoder) {
            return delegatorFees.add(transcoderFees);
        } else {
            return delegatorFees;
        }
    }

    function rewardPoolShare(TokenPools.Data storage tokenPools, uint256 _stake, bool _isTranscoder) internal view returns (uint256) {
        uint256 transcoderRewards = 0;
        uint256 delegatorRewards = 0;

        if (tokenPools.totalStake > 0) {
            transcoderRewards = tokenPools.rewardPool.mul(tokenPools.transcoderBlockRewardCut).div(PERC_DIVISOR);
            delegatorRewards = tokenPools.rewardPool.sub(transcoderRewards).mul(_stake).div(tokenPools.totalStake);
        }

        if (_isTranscoder) {
            return delegatorRewards.add(transcoderRewards);
        } else {
            return delegatorRewards;
        }
    }
}
