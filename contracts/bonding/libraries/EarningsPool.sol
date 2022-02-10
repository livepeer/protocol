// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../../libraries/MathUtils.sol";

import "@openzeppelin/contracts/utils/math/SafeMath.sol";

/**
 * @title EarningsPool
 * @dev Manages reward and fee pools for delegators and transcoders
 */
library EarningsPool {
    using SafeMath for uint256;

    struct Data {
        uint256 totalStake; // Transcoder's total stake during the earnings pool's round
        uint256 transcoderRewardCut; // Transcoder's reward cut during the earnings pool's round
        uint256 transcoderFeeShare; // Transcoder's fee share during the earnings pool's round
        // LIP-36 (https://github.com/livepeer/LIPs/blob/master/LIPs/LIP-36.md) fields
        // See EarningsPoolLIP36.sol
        uint256 cumulativeRewardFactor;
        uint256 cumulativeFeeFactor;
    }

    /**
     * @dev Sets transcoderRewardCut and transcoderFeeshare for an EarningsPool
     * @param earningsPool Storage pointer to EarningsPool struct
     * @param _rewardCut Reward cut of transcoder during the earnings pool's round
     * @param _feeShare Fee share of transcoder during the earnings pool's round
     */
    function setCommission(
        EarningsPool.Data storage earningsPool,
        uint256 _rewardCut,
        uint256 _feeShare
    ) internal {
        earningsPool.transcoderRewardCut = _rewardCut;
        earningsPool.transcoderFeeShare = _feeShare;
    }

    /**
     * @dev Sets totalStake for an EarningsPool
     * @param earningsPool Storage pointer to EarningsPool struct
     * @param _stake Total stake of the transcoder during the earnings pool's round
     */
    function setStake(EarningsPool.Data storage earningsPool, uint256 _stake) internal {
        earningsPool.totalStake = _stake;
    }
}
