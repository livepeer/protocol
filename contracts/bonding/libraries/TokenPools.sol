pragma solidity ^0.4.17;

import "../../libraries/MathUtils.sol";

import "zeppelin-solidity/contracts/math/SafeMath.sol";


library TokenPools {
    using SafeMath for uint256;

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
            uint256 delegatorsFees = MathUtils.percOf(tokenPools.feePool, tokenPools.transcoderFeeShare);
            transcoderFees = tokenPools.feePool.sub(delegatorsFees);
            delegatorFees = MathUtils.percOf(delegatorsFees, _stake, tokenPools.claimableStake);
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
            transcoderRewards = MathUtils.percOf(tokenPools.rewardPool, tokenPools.transcoderBlockRewardCut);
            delegatorRewards = MathUtils.percOf(tokenPools.rewardPool.sub(transcoderRewards), _stake, tokenPools.claimableStake);
        }

        if (_isTranscoder) {
            return delegatorRewards.add(transcoderRewards);
        } else {
            return delegatorRewards;
        }
    }
}
