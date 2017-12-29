pragma solidity ^0.4.17;

import "zeppelin-solidity/contracts/math/SafeMath.sol";


library TokenPools {
    using SafeMath for uint256;

    uint256 public constant PERC_DIVISOR = 1000000;

    // Represents rewards and fees to be distributed to delegators
    struct Data {
        uint256 rewardPool;                // Rewards in the pool
        uint256 feePool;                   // Fees in the pool
        uint256 totalStake;                // Transcoder's total stake during the pool's round
        uint256 claimableStake;            // Stake that can be used to claim portions of the fee and reward pool
        uint256 transcoderBlockRewardCut;  // Block reward cut for the reward pool
        uint256 transcoderFeeShare;        // Fee share for the fee pool
    }

    function init(TokenPools.Data storage tokenPools, uint256 _stake, uint256 _blockRewardCut, uint256 _feeShare) internal {
        tokenPools.totalStake = _stake;
        tokenPools.claimableStake = _stake;
        tokenPools.transcoderBlockRewardCut = _blockRewardCut;
        tokenPools.transcoderFeeShare = _feeShare;
    }

    function hasClaimableShares(TokenPools.Data storage tokenPools) internal view returns (bool) {
        return tokenPools.claimableStake > 0;
    }

    function claimShare(TokenPools.Data storage tokenPools, uint256 _stake, bool _isTranscoder) internal returns (uint256, uint256) {
        uint256 fees = 0;
        uint256 rewards = 0;

        if (tokenPools.feePool > 0) {
            // Compute fee share
            fees = feePoolShare(tokenPools, _stake, _isTranscoder);
            tokenPools.feePool = tokenPools.feePool.sub(fees);
        }

        if (tokenPools.rewardPool > 0) {
            // Compute reward share
            rewards = rewardPoolShare(tokenPools, _stake, _isTranscoder);
            tokenPools.rewardPool = tokenPools.rewardPool.sub(rewards);
        }

        // Update remaning claimable stake for token pools
        tokenPools.claimableStake = tokenPools.claimableStake.sub(_stake);

        return (fees, rewards);
    }

    function feePoolShare(TokenPools.Data storage tokenPools, uint256 _stake, bool _isTranscoder) internal view returns (uint256) {
        uint256 transcoderFees = 0;
        uint256 delegatorFees = 0;

        if (tokenPools.claimableStake > 0) {
            transcoderFees = tokenPools.feePool.mul(PERC_DIVISOR.sub(tokenPools.transcoderFeeShare)).div(PERC_DIVISOR);

            // Compute delegator's claimable stake percentage
            uint256 percPoints = _stake.mul(PERC_DIVISOR).div(tokenPools.claimableStake);
            // Compute delegator's fees according to claimable stake percentage
            delegatorFees = tokenPools.feePool.sub(transcoderFees).mul(percPoints).div(PERC_DIVISOR);
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

        if (tokenPools.claimableStake > 0) {
            transcoderRewards = tokenPools.rewardPool.mul(tokenPools.transcoderBlockRewardCut).div(PERC_DIVISOR);

            // Compute delegator's claimable stake percentage
            uint256 percPoints = _stake.mul(PERC_DIVISOR).div(tokenPools.claimableStake);
            // Compute delegator's rewards according to claimable stake percentage
            delegatorRewards = tokenPools.rewardPool.sub(transcoderRewards).mul(percPoints).div(PERC_DIVISOR);
        }

        if (_isTranscoder) {
            return delegatorRewards.add(transcoderRewards);
        } else {
            return delegatorRewards;
        }
    }
}
