// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./EarningsPool.sol";
import "../../libraries/PreciseMathUtils.sol";

import "@openzeppelin/contracts/utils/math/SafeMath.sol";

library EarningsPoolLIP36 {
    using SafeMath for uint256;

    /**
     * @notice Update the cumulative fee factor stored in an earnings pool with new fees
     * @param earningsPool Storage pointer to EarningsPools.Data struct
     * @param _prevEarningsPool In-memory EarningsPool.Data struct that stores the previous cumulative reward and fee factors
     * @param _fees Amount of new fees
     */
    function updateCumulativeFeeFactor(
        EarningsPool.Data storage earningsPool,
        EarningsPool.Data memory _prevEarningsPool,
        uint256 _fees
    ) internal {
        uint256 prevCumulativeFeeFactor = _prevEarningsPool.cumulativeFeeFactor;
        uint256 prevCumulativeRewardFactor = _prevEarningsPool.cumulativeRewardFactor != 0
            ? _prevEarningsPool.cumulativeRewardFactor
            : PreciseMathUtils.percPoints(1, 1);

        // Initialize the cumulativeFeeFactor when adding fees for the first time
        if (earningsPool.cumulativeFeeFactor == 0) {
            earningsPool.cumulativeFeeFactor = prevCumulativeFeeFactor.add(
                PreciseMathUtils.percOf(prevCumulativeRewardFactor, _fees, earningsPool.totalStake)
            );
            return;
        }

        earningsPool.cumulativeFeeFactor = earningsPool.cumulativeFeeFactor.add(
            PreciseMathUtils.percOf(prevCumulativeRewardFactor, _fees, earningsPool.totalStake)
        );
    }

    /**
     * @notice Update the cumulative reward factor stored in an earnings pool with new rewards
     * @param earningsPool Storage pointer to EarningsPool.Data struct
     * @param _prevEarningsPool Storage pointer to EarningsPool.Data struct that stores the previous cumulative reward factor
     * @param _rewards Amount of new rewards
     */
    function updateCumulativeRewardFactor(
        EarningsPool.Data storage earningsPool,
        EarningsPool.Data memory _prevEarningsPool,
        uint256 _rewards
    ) internal {
        uint256 prevCumulativeRewardFactor = _prevEarningsPool.cumulativeRewardFactor != 0
            ? _prevEarningsPool.cumulativeRewardFactor
            : PreciseMathUtils.percPoints(1, 1);

        earningsPool.cumulativeRewardFactor = prevCumulativeRewardFactor.add(
            PreciseMathUtils.percOf(prevCumulativeRewardFactor, _rewards, earningsPool.totalStake)
        );
    }

    /**
     * @notice Calculates a delegator's cumulative stake and fees using the LIP-36 earnings claiming algorithm.
     * @dev This internally calls {delegatorCumulativeStake} and {delegatorCumulativeFees} to calculate stake and fees.
     * @param _startPool The earning pool from the start round for the start cumulative factors. Normally this is the
     * earning pool from the {Delegator-lastClaimRound} round, as the round where `_stake` was measured.
     * @param _endPool The earning pool from the end round for the end cumulative factors
     * @param _stake The delegator stake at the start round, before earned rewards. Normally {Delegator-bondedAmount}.
     * @param _fees The delegator's initial fees before including earned fees
     * @return cStake , cFees where cStake is the delegator's cumulative stake including earned rewards and cFees is the
     * delegator's cumulative fees including earned fees
     */
    function delegatorCumulativeStakeAndFees(
        EarningsPool.Data memory _startPool,
        EarningsPool.Data memory _endPool,
        uint256 _stake,
        uint256 _fees
    ) internal pure returns (uint256 cStake, uint256 cFees) {
        cStake = delegatorCumulativeStake(_startPool, _endPool, _stake);
        cFees = delegatorCumulativeFees(_startPool, _endPool, _stake, _fees);
    }

    /**
     * @notice Calculates a delegator's cumulative stake using the LIP-36 earnings claiming algorithm.
     * @param _startPool The earning pool from the start round for the start cumulative factors. Normally this is the
     * earning pool from the {Delegator-lastClaimRound} round, as the round where `_stake` was measured.
     * @param _endPool The earning pool from the end round for the end cumulative factors.
     * @param _stake The delegator stake at the start round, before earned rewards. Normally {Delegator-bondedAmount}.
     * @return The delegator's cumulative stake including earned rewards.
     */
    function delegatorCumulativeStake(
        EarningsPool.Data memory _startPool,
        EarningsPool.Data memory _endPool,
        uint256 _stake
    ) internal pure returns (uint256) {
        // If the start cumulativeRewardFactor is 0 set the default value to PreciseMathUtils.percPoints(1, 1)
        if (_startPool.cumulativeRewardFactor == 0) {
            _startPool.cumulativeRewardFactor = PreciseMathUtils.percPoints(1, 1);
        }

        // If the end cumulativeRewardFactor is 0 set the default value to PreciseMathUtils.percPoints(1, 1)
        if (_endPool.cumulativeRewardFactor == 0) {
            _endPool.cumulativeRewardFactor = PreciseMathUtils.percPoints(1, 1);
        }

        return PreciseMathUtils.percOf(_stake, _endPool.cumulativeRewardFactor, _startPool.cumulativeRewardFactor);
    }

    /**
     * @notice Calculates a delegator's cumulative fees using the LIP-36 earnings claiming algorithm.
     * @param _startPool The earning pool from the start round for the start cumulative factors. Normally this is the
     * earning pool from the {Delegator-lastClaimRound} round, as the round where `_stake` was measured.
     * @param _endPool The earning pool from the end round for the end cumulative factors.
     * @param _stake The delegator stake at the start round, before earned rewards. Normally {Delegator-bondedAmount}.
     * @param _fees The delegator's initial fees before including earned fees.
     * @return The delegator's cumulative fees including earned fees.
     */
    function delegatorCumulativeFees(
        EarningsPool.Data memory _startPool,
        EarningsPool.Data memory _endPool,
        uint256 _stake,
        uint256 _fees
    ) internal pure returns (uint256) {
        // If the start cumulativeRewardFactor is 0 set the default value to PreciseMathUtils.percPoints(1, 1)
        if (_startPool.cumulativeRewardFactor == 0) {
            _startPool.cumulativeRewardFactor = PreciseMathUtils.percPoints(1, 1);
        }

        // If the end cumulativeRewardFactor is 0 set the default value to PreciseMathUtils.percPoints(1, 1)
        if (_endPool.cumulativeRewardFactor == 0) {
            _endPool.cumulativeRewardFactor = PreciseMathUtils.percPoints(1, 1);
        }

        uint256 earnedFees = PreciseMathUtils.percOf(
            _stake,
            _endPool.cumulativeFeeFactor.sub(_startPool.cumulativeFeeFactor),
            _startPool.cumulativeRewardFactor
        );
        return _fees.add(earnedFees);
    }
}
