pragma solidity ^0.5.11;

import "./EarningsPool.sol";

import "openzeppelin-solidity/contracts/math/SafeMath.sol";


library EarningsPoolLIP36 {
    using SafeMath for uint256;

    /**
     * @notice Update the cumulative fee factor stored in an earnings pool with new fees
     * @param earningsPool Storage pointer to EarningsPools.Data struct
     * @param _prevEarningsPool In-memory EarningsPool.Data struct that stores the previous cumulative reward and fee factors
     * @param _fees Amount of new fees
     */
    function updateCumulativeFeeFactor(EarningsPool.Data storage earningsPool, EarningsPool.Data memory _prevEarningsPool, uint256 _fees) internal {
        uint256 prevCumulativeFeeFactor = _prevEarningsPool.cumulativeFeeFactor;
        uint256 prevCumulativeRewardFactor = _prevEarningsPool.cumulativeRewardFactor != 0 ? _prevEarningsPool.cumulativeRewardFactor : MathUtils.percPoints(1,1);

        // Initialize the cumulativeFeeFactor when adding fees for the first time
        if (earningsPool.cumulativeFeeFactor == 0) {
            earningsPool.cumulativeFeeFactor = prevCumulativeFeeFactor.add(
                MathUtils.percOf(prevCumulativeRewardFactor, _fees, earningsPool.totalStake)
            );
            return;
        }

        earningsPool.cumulativeFeeFactor = earningsPool.cumulativeFeeFactor.add(
            MathUtils.percOf(prevCumulativeRewardFactor, _fees, earningsPool.totalStake)
        );
    }

    /**
     * @notice Update the cumulative reward factor stored in an earnings pool with new rewards
     * @param earningsPool Storage pointer to EarningsPool.Data struct
     * @param _prevEarningsPool Storage pointer to EarningsPool.Data struct that stores the previous cumulative reward factor
     * @param _rewards Amount of new rewards
     */
    function updateCumulativeRewardFactor(EarningsPool.Data storage earningsPool, EarningsPool.Data storage _prevEarningsPool, uint256 _rewards) internal {
        uint256 prevCumulativeRewardFactor = _prevEarningsPool.cumulativeRewardFactor != 0 ? _prevEarningsPool.cumulativeRewardFactor : MathUtils.percPoints(1,1);

        earningsPool.cumulativeRewardFactor = prevCumulativeRewardFactor.add(
            MathUtils.percOf(prevCumulativeRewardFactor, _rewards, earningsPool.totalStake)
        );
    }
}