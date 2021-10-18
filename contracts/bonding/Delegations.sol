// SPDX-FileCopyrightText: 2021 Livepeer <nico@livepeer.org>
// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../utils/MathUtils.sol";

/**
 * @title Delegations
 * @author Nico Vergauwen (@kyriediculous)
 * @notice Delegations is a Solidity library that handles accounting logic for a stake based protocol whereby users
    can stake tokens and earn rewards in that tokens as well as fees in another token or ETH.
    
    The implementation details and actual handling of funds transfer is left to the implementer
        of the library so the library is token standard agnostic.
 */

library Delegations {
    /**
     @notice holds reward and fee per unit stake for each round 
     */
    struct Accumulator {
        uint256 rewardPerStake;
        uint256 feePerStake;
    }

    /**
     @notice Delegation holds the necessary info for delegations to a delegation pool
     */
    struct Delegation {
        address owner; // address of the delegator
        uint256 stake; // total tokens staked by the delegator
        uint256 fees; // total fees earned by the delegator
        uint256 stakeCheckpoint; // stake when the delegation object was last updated
        uint256 accRewardPerStakeCheckpoint; // accrued reward per stake when rewards were last updated
        uint256 accFeePerStakeCheckpoint; // accrued fee per stake checkpoint when fees were last updated
        uint256 lastUpdateRound; // round in which the delegation was last updated
    }

    /**
     @notice A delegation pool accrues delegator rewards and fees for an orchestrator and handles accounting
     */
    struct Pool {
        address owner; // address orchestrator which created/owns the pool
        uint256 stake; // total amount of tokens active in the current round
        uint256 nextStake; // tokens which will become active for rewards in the next round
        uint256 lastUpdateRound; // round in which the pool was last updated
        mapping(uint256 => Accumulator) accumulators;
        mapping(address => Delegation) delegations;
    }

    // POOL ACTIONS

    /**
     * @notice Stake an amount of tokens in the pool.
     * @param _pool storage pointer to the delegation pool
     * @param _delegator address of the delegator that is staking to the pool
     * @param _amount amount of tokens being staked by the delegator
     * @param _currentRound current ongoing round
     */
    function delegate(
        Pool storage _pool,
        address _delegator,
        uint256 _amount,
        uint256 _currentRound
    ) internal {
        // set first delegator as pool owner i.e when orchestrator creates a pool
        if (_pool.owner == address(0)) {
            _pool.owner = _delegator;
        }

        // update the entire pool
        _updatePool(_pool, _currentRound);

        // create a delegation object if doesn't already exist
        if (_pool.delegations[_delegator].owner == address(0)) {
            _pool.delegations[_delegator].owner = _delegator;
        }

        // update the delegation
        _updateDelegation(_pool, _delegator, int256(_amount), _currentRound);

        // add incoming tokens to be active for next round
        _pool.nextStake += _amount;
    }

    /**
     * @notice unstake an amount of tokens in the pool.
     * @param _pool storage pointer to the delegation pool
     * @param _delegator address of the delegator that is staking to the pool
     * @param _amount amount of tokens being staked by the delegator
     * @param _currentRound current ongoing round
     */
    function undelegate(
        Pool storage _pool,
        address _delegator,
        uint256 _amount,
        uint256 _currentRound
    ) internal {
        // update the entire pool
        _updatePool(_pool, _currentRound);

        // update the delegation
        _updateDelegation(_pool, _delegator, -int256(_amount), _currentRound);

        // make tokens inactive in the next round
        _pool.nextStake -= _amount;
    }

    /**
     * @notice updates the orchestrator's pool for the current round
     *  the stake which was accumulated after the round started is made active for rewards
     *  the accumulator values for the previous round is copied over to the current round
     * @param _pool storage pointer to the delegation pool
     * @param _currentRound current ongoing round
     */
    function _updatePool(Pool storage _pool, uint256 _currentRound) internal {
        // do nothing if the pool was already updated in the current round
        if (_pool.lastUpdateRound >= _currentRound) {
            return;
        }

        // make the new stake active for rewards
        _pool.stake = _pool.nextStake;

        _pool.accumulators[_currentRound].rewardPerStake = _getAccRewardPerStake(_pool, _pool.lastUpdateRound);
        _pool.accumulators[_currentRound].feePerStake = _getAccFeePerStake(_pool, _pool.lastUpdateRound);

        // mark the pool as recently updated
        _pool.lastUpdateRound = _currentRound;
    }

    function _updateDelegation(
        Pool storage _pool,
        address _delegator,
        int256 _amount,
        uint256 _currentRound
    ) internal {
        Delegation storage _delegation = _pool.delegations[_delegator];

        // update the fees and rewards for the delegation earned in the previous round
        _delegation.stake += _rewards(_pool, _delegation);
        _delegation.fees += _fees(_pool, _delegation);

        // if the amount was "undelegated", reduce the pool's stake amount active for reward

        // Round N stake 3000
        // Round N stake 2000
        // stake 0 , nextStake 5000
        // Round N +1 stake 1000
        // stake 5000 nextStake 6000
        // stakeCHeckpoint = 5000 , delegation.stake = 6000
        // Round N +1 unstake 6000
        // stake 5000-5000=0 nextStake=nextStake-delegation.stake=6000-6000

        if (_amount < 0) {
            // if the delegation lastUpdateRound >= pool.lastUpdateRound
            // substract '_delegation.stakeCheckpoint' from '_pool.stake' unless '_amount' is smaller
            // else subtract '_amount' from '_pool.stake'
            // In every case subtract '_amount' frrom '_pool.nextStake'
            if (
                _delegation.lastUpdateRound >= _pool.lastUpdateRound && uint256(-_amount) > _delegation.stakeCheckpoint
            ) {
                _pool.stake -= _delegation.stakeCheckpoint;
            } else {
                _pool.stake -= uint256(-_amount);
            }
            _delegation.stake -= uint256(-_amount);
            // When undelegating set '_delegation.stakeCheckpoint' to the remaining stake for the delegation (update instantly)
            _delegation.stakeCheckpoint = _delegation.stake;
        } else {
            // When adding stake to a delegation only update '_delegation.stakeCheckpoint' if the previous value is stale
            // otherwise multiple delegations in the same round would update the checkpoint
            if (_delegation.lastUpdateRound < _currentRound) {
                _delegation.stakeCheckpoint = _delegation.stake;
            }
            _delegation.stake += uint256(_amount);
        }

        _delegation.accRewardPerStakeCheckpoint = _getAccRewardPerStake(_pool, _currentRound);
        _delegation.accFeePerStakeCheckpoint = _getAccFeePerStake(_pool, _currentRound);

        _delegation.lastUpdateRound = _currentRound;
    }

    function addRewards(
        Pool storage _pool,
        uint256 _amount,
        uint256 _currentRound
    ) internal {
        _updatePool(_pool, _currentRound);

        if (_pool.stake == 0) return;

        uint256 currentAcc = _getAccRewardPerStake(_pool, _pool.lastUpdateRound);
        _pool.accumulators[_currentRound].rewardPerStake =
            currentAcc +
            MathUtils.percOf(_amount, currentAcc, _pool.stake);
        _pool.nextStake += _amount;
    }

    function addFees(
        Pool storage _pool,
        uint256 _amount,
        uint256 _currentRound
    ) internal {
        _updatePool(_pool, _currentRound);

        uint256 currentAcc = _getAccFeePerStake(_pool, _currentRound);
        _pool.accumulators[_currentRound].feePerStake += MathUtils.percOf(currentAcc, _amount, _pool.stake);
    }

    function _rewards(Pool storage _pool, Delegation storage _delegation) internal view returns (uint256) {
        // accRewardPerShare only changes when rewards are earned
        uint256 rewardPerStakeNew = _getAccRewardPerStake(_pool, _pool.lastUpdateRound);
        uint256 rewardPerStakeOld = _getAccRewardPerStake(_pool, _delegation.lastUpdateRound);

        uint256 checkpoint = _delegation.accRewardPerStakeCheckpoint != 0
            ? _delegation.accRewardPerStakeCheckpoint
            : MathUtils.percPoints(1, 1);

        uint256 lookbackRewards = MathUtils.percOf(_delegation.stakeCheckpoint, rewardPerStakeOld, checkpoint) -
            _delegation.stakeCheckpoint;

        uint256 stake = MathUtils.percOf(_delegation.stake + lookbackRewards, rewardPerStakeNew, rewardPerStakeOld);
        return stake - _delegation.stake;
    }

    function _fees(Pool storage _pool, Delegation storage _delegation) internal view returns (uint256 fees) {
        // accFeePerShare only changes when fees are earned
        uint256 feePerStakeNew = _getAccFeePerStake(_pool, _pool.lastUpdateRound);
        uint256 feePerStakeOld = _getAccFeePerStake(_pool, _delegation.lastUpdateRound);

        uint256 feeCheckpoint = _delegation.accFeePerStakeCheckpoint != 0
            ? _delegation.accFeePerStakeCheckpoint
            : MathUtils.percPoints(1, 1);
        uint256 rewardCheckpoint = _delegation.accRewardPerStakeCheckpoint != 0
            ? _delegation.accRewardPerStakeCheckpoint
            : MathUtils.percPoints(1, 1);

        uint256 rewardPerStakeOld = _getAccRewardPerStake(_pool, _delegation.lastUpdateRound);

        fees = MathUtils.percOf(_delegation.stakeCheckpoint, feePerStakeOld - feeCheckpoint, rewardCheckpoint);
        fees += MathUtils.percOf(_delegation.stake, feePerStakeNew - feePerStakeOld, rewardPerStakeOld);
    }

    function _getAccRewardPerStake(Pool storage _pool, uint256 _round) internal view returns (uint256 _rewardPerStake) {
        _rewardPerStake = MathUtils.percPoints(1, 1);
        if (_pool.accumulators[_round].rewardPerStake != 0) {
            _rewardPerStake = _pool.accumulators[_round].rewardPerStake;
        }
    }

    function _getAccFeePerStake(Pool storage _pool, uint256 _round) internal view returns (uint256 _feePerStake) {
        _feePerStake = MathUtils.percPoints(1, 1);
        if (_pool.accumulators[_round].feePerStake != 0) {
            _feePerStake = _pool.accumulators[_round].feePerStake;
        }
    }

    /**
     * @notice Returns the total stake in the delegation pool
     * @param _pool storage pointer to the delegation pool
     * @return total stake in the pool
     */
    function poolTotalStake(Pool storage _pool) internal view returns (uint256) {
        return _pool.nextStake;
    }

    /**
     * @notice Returns the stake of a delegator in the pool
     * @param _pool storage pointer to the delegation pool
     * @param _delegator address of the delegator
     * @return total stake of the delegator including rewards
     */
    function stakeOf(Pool storage _pool, address _delegator) internal view returns (uint256) {
        Delegation storage _delegation = _pool.delegations[_delegator];
        return _delegation.stake + _rewards(_pool, _delegation);
    }

    /**
     * @notice Returns the fees of a delegator in the pool
     * @param _pool storage pointer to the delegation pool
     * @param _delegator address of the delegator
     * @return total fees of the delegator
     */
    function feesOf(Pool storage _pool, address _delegator) internal view returns (uint256) {
        Delegation storage _delegation = _pool.delegations[_delegator];
        return _fees(_pool, _delegation);
    }
}
