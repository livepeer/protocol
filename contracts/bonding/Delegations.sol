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
    
    The library uses share-based accounting whereby a nominal amount of shares represent 
        an intrinsic amount of stake (including rewards) and protocol fees. Meaning that
        while the amount of shares a user holds can remain unchanged, the amount of stake
        and fees it represent can fluctuate as rewards/fees are earned or the delegate's 
        stake is slashed.
 */

library Delegations {
    struct Accumulators {
        uint256 rewardPerShare;
        uint256 feePerShare;
    }

    /**
     @notice Delegation holds the necessary info for delegations to a delegation pool
     */
    struct Delegation {
        uint256 shares;
        uint256 pendingFees;
        uint256 lastUpdateRound;
        uint256 rewardPerShareCheckpoint;
        uint256 feePerShareCheckpoint;
        uint256 lookbackShares;
    }

    /**
     @notice A delegation pool accrues delegator rewards and fees for an orchestrator and handles accounting
     */
    struct Pool {
        uint256 shares;
        uint256 nextShares;
        uint256 principle;
        uint256 stake;
        uint256 nextStake;
        uint128 rewardCut;
        uint128 feeCut;
        uint256 lastRewardRound; // Q : can we remove and use lastUpdateRound ?
        uint256 lastFeeRound; // Q: can we remove and use lastUpdateRound ?
        uint256 lastUpdateRound;
        address owner;
        mapping(uint256 => Accumulators) accumulators;
        mapping(address => Delegation) delegations;
    }

    // POOL ACTIONS

    /**
     * @notice Stake an amount of tokens in the pool. Calculates the amount of shares to mint based on the current
        amount of total stake and outstanding shares. Mints the calculated amount of shares for the delegator 
        and adds the staked amount to the pool's total stake.
     * @param _pool storage pointer to the delegation pool
     * @param _delegator address of the delegator that is staking to the pool
     * @param _amount amount of tokens being staked by the delegator
     * @param _currentRound currentRound
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

        _updatePool(_pool, _currentRound);

        uint256 shares = _tokensToShares(_pool, _amount);
        _updateDelegation(_pool, _delegator, int256(shares), _currentRound);

        _pool.nextStake += _amount;
        _pool.principle += _amount;
    }

    /**
     * @notice Unstake an amount of tokens from the pool. Calculates the maount of shares to burn based on the current
        amount of total stake and outstanding shares. Burns the calculated amount of shares from the delegator 
        and subtracts the unstaked amount from the pool's total stake.
     * @param _pool storage pointer to the delegation pool
     * @param _delegator address of the delegator that is unstaking from the pool
     * @param _amount amount of tokens being unstaked by the delegator
     * @param _currentRound currentRound
     */
    function undelegate(
        Pool storage _pool,
        address _delegator,
        uint256 _amount,
        uint256 _currentRound
    ) internal {
        _updatePool(_pool, _currentRound);

        uint256 shares = _tokensToShares(_pool, _amount);
        _updateDelegation(_pool, _delegator, -int256(shares), _currentRound);

        _pool.nextStake -= _amount;
        _pool.principle -= _amount;
    }

    function _updatePool(Pool storage _pool, uint256 _currentRound) internal {
        uint256 _lastUpdateRound = _pool.lastUpdateRound;
        if (_lastUpdateRound >= _currentRound) {
            return;
        }

        _pool.lastUpdateRound = _currentRound;

        _pool.shares = _pool.nextShares;
        _pool.stake = _pool.nextStake;

        _pool.accumulators[_currentRound] = _pool.accumulators[_lastUpdateRound];
    }

    function _updateDelegation(
        Pool storage _pool,
        address _delegator,
        int256 _sharesDelta,
        uint256 _currentRound
    ) internal {
        Delegation storage _delegation = _pool.delegations[_delegator];

        // convert outstanding rewards to shares
        uint256 rewards = _rewards(_pool, _delegation);
        uint256 sharesDeltaFromRewards = _tokensToShares(_pool, rewards);
        _pool.principle += rewards;

        // add to pending fees
        _delegation.pendingFees += _fees(_pool, _delegation);

        // checkpoint accumulators
        _delegation.rewardPerShareCheckpoint = _pool.accumulators[_pool.lastRewardRound].rewardPerShare;
        _delegation.feePerShareCheckpoint = _pool.accumulators[_pool.lastFeeRound].feePerShare;

        // set eligible shares for current round
        _delegation.lookbackShares = _delegation.shares;

        //
        _delegation.lastUpdateRound = _currentRound;
        int256 totalSharesDelta = _sharesDelta + int256(sharesDeltaFromRewards);
        _delegation.shares = _addDelta(_delegation.shares, totalSharesDelta);

        // update nextShares
        _pool.nextShares = _addDelta(_pool.nextShares, totalSharesDelta);
    }

    // REWARDS ACCOUNTING

    /**
     * @notice calculates the pending rewards for the delegation
     * @param _pool storage pointer to the delegation pool
     * @param _delegation delegation
     */
    function _rewards(Pool storage _pool, Delegation storage _delegation) internal view returns (uint256 rewards) {
        uint256 lookback = _pool.accumulators[_delegation.lastUpdateRound].rewardPerShare;
        uint256 checkpoint = _delegation.rewardPerShareCheckpoint;
        uint256 lookbackShares = _delegation.lookbackShares;

        uint256 lookbackRewards;
        if (lookbackShares > 0) {
            lookbackRewards = MathUtils.percOf(lookbackShares, lookback - checkpoint);
        }

        uint256 otherRewards = MathUtils.percOf(
            _delegation.shares,
            _pool.accumulators[_pool.lastRewardRound].rewardPerShare - lookback
        );

        rewards = lookbackRewards + otherRewards;
    }

    /**
     * @notice Add rewards to the delegation pool, increases the total stake in the pool by the specified amount. 
        Returns the new amount of total stake in the pool.
     * @param _pool storage pointer to the delegation pool
     * @param _amount amount of tokens to add to the total stake
     */
    function addRewards(
        Pool storage _pool,
        uint256 _amount,
        uint256 _currentRound
    ) internal {
        _updatePool(_pool, _currentRound);

        // calculate reward cut
        uint256 rewardCutAmount = MathUtils.percOf(_amount, _pool.rewardCut);
        uint256 rewardShareAmount = _amount - rewardCutAmount;

        uint256 _shares = _pool.shares;
        if (_shares > 0) {
            _pool.accumulators[_currentRound].rewardPerShare += MathUtils.percPoints(rewardShareAmount, _shares);
        }
        // convert rewardCutAmount to shares for pool owner (orchestrator)
        // TODO: double check this works
        _updateDelegation(_pool, _pool.owner, int256(rewardCutAmount), _currentRound);
        _pool.lastRewardRound = _currentRound;
        _pool.nextStake += _amount;
    }

    // FEES ACCOUNTING

    /**
     * @notice calculates the pending fees for the delegation
     * @param _pool storage pointer to the delegation pool
     * @param _delegation delegation
     */
    function _fees(Pool storage _pool, Delegation storage _delegation) internal view returns (uint256 fees) {
        uint256 lookback = _pool.accumulators[_delegation.lastUpdateRound].feePerShare;
        uint256 checkpoint = _delegation.feePerShareCheckpoint;
        uint256 lookbackShares = _delegation.lookbackShares;

        uint256 lookbackFees;
        if (lookbackShares > 0) {
            lookbackFees = MathUtils.percOf(lookbackShares, lookback - checkpoint);
        }

        uint256 otherFees = MathUtils.percOf(
            _delegation.shares,
            _pool.accumulators[_pool.lastFeeRound].feePerShare - lookback
        );

        fees = lookbackFees + otherFees;
    }

    function feesOf(Pool storage _pool, address _delegator) internal view returns (uint256) {
        // TODO
        Delegation storage _delegation = _pool.delegations[_delegator];
        return _fees(_pool, _delegation);
    }

    /**
     * @notice Add fees to the delegation pool.
        Increases the fees by the specified amount and returns the new total amount of fees earned by the pool.
     * @param _pool storage pointer to the delegation pool
     * @param _amount amount of fees to add to the pool
     * @param _currentRound currentRound
     */
    function addFees(
        Pool storage _pool,
        uint256 _amount,
        uint256 _currentRound
    ) internal {
        _updatePool(_pool, _currentRound);

        // calculate fee cut
        uint256 feeCutAmount = MathUtils.percOf(_amount, _pool.feeCut);

        uint256 feeShareAmount = _amount - feeCutAmount;

        uint256 _shares = _pool.shares;

        if (_shares > 0) {
            _pool.accumulators[_currentRound].feePerShare += MathUtils.percPoints(feeShareAmount, _shares);
        }

        // add feeCutAmount to fees for Pool owner (orchestrator)
        _pool.delegations[_pool.owner].pendingFees += feeCutAmount;

        _pool.lastFeeRound = _currentRound;
    }

    /**
     * @notice Returns the nominal amount of shares of a delegation pool owned by a delegator
     * @param _pool storage pointer to the delegation pool
     * @param _delegator address of the delegator
     * @return shares of the delegation pool owned by the delegator
     */
    function sharesOf(Pool storage _pool, address _delegator) internal view returns (uint256 shares) {
        shares = _pool.delegations[_delegator].shares;
    }

    /**
     * @notice Returns the total stake in the delegation pool
     * @param _pool storage pointer to the delegation pool
     * @return total stake in the pool
     */
    function poolTotalStake(Pool storage _pool) internal view returns (uint256) {
        return _pool.principle;
    }

    function stakeOf(Pool storage _pool, address _delegator) internal view returns (uint256) {
        Delegation storage _delegation = _pool.delegations[_delegator];
        // principle * ( share / totalShares ) + rewards
        if (_pool.principle == 0 || _delegation.shares == 0) return 0;
        return MathUtils.percOf(_pool.principle, _delegation.shares, _pool.nextShares) + _rewards(_pool, _delegation);
    }

    /**
     * @notice Convert an amount of tokens to the nominal amount of shares it represents in the pool
     * @param _pool storage pointer to the delegation pool
     * @param _tokens amount of tokens to calculate share amount for
     * @return shares amount of shares that represent the underlying tokens
     */
    function _tokensToShares(Pool storage _pool, uint256 _tokens) internal view returns (uint256 shares) {
        uint256 totalStake = _pool.nextStake;
        uint256 totalShares = _pool.nextShares;

        if (_tokens == 0) return 0;

        if (totalShares == 0) {
            return _tokens;
        } else if (totalStake == 0) {
            return 0;
        } else {
            shares = MathUtils.percOf(_tokens, totalShares, totalStake);
        }
    }

    /**
     * @notice Convert an amount of shares to the amount of tokens in the delegation pool it represents
     * @param _pool storage pointer to the delegation pool
     * @param _shares amount of shares to calculate token amount for
     * @return tokens amount of tokens represented by the shares
     */
    function _sharesToTokens(Pool storage _pool, uint256 _shares) internal view returns (uint256 tokens) {
        uint256 totalShares = _pool.nextShares;

        if (_shares == 0 || totalShares == 0) {
            return 0;
        }

        tokens = MathUtils.percOf(_pool.nextStake, _shares, totalShares);
    }

    function _addDelta(uint256 _x, int256 _y) internal pure returns (uint256 z) {
        if (_y < 0) {
            z = _x - uint256(-_y);
        } else {
            z = _x + uint256(_y);
        }
    }
}
