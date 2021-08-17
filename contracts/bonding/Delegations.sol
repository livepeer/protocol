// SPDX-FileCopyrightText: 2021 Livepeer <nico@livepeer.org>
// SPDX-License-Identifier: GPL-3.0

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
    /**
     @notice Delegation holds the necessary info for delegations to a delegation pool
     */
    struct Delegation {
        uint256 shares; // nominal amount of shares held by the Delegation
        uint256 lastCFF; // amount of fees in the pool after last claim
    }

    /**
     @notice A delegation pool accrues delegator rewards and fees for an orchestrator and handles accounting
     */
    struct Pool {
        uint256 totalShares; // total amount of outstanding shares
        uint256 activeFeeShares; // amount of shares active for fees
        uint256 totalStake; // total amount of tokens held by the EarningsPool
        uint256 CFF; // total amount of available fees (claimed or unclaimed, but not withdrawn)
        // mapping of a delegate's address to a Delegation
        mapping(address => Delegation) delegations;
    }

    /**
     * @notice Stake an amount of tokens in the pool. Calculates the amount of shares to mint based on the current
        amount of total stake and outstanding shares. Mints the calculated amount of shares for the delegator 
        and adds the staked amount to the pool's total stake.
     * @param _pool storage pointer to the delegation pool
     * @param _delegator address of the delegator that is staking to the pool
     * @param _amount amount of tokens being staked by the delegator
     */
    function stake(
        Pool storage _pool,
        address _delegator,
        uint256 _amount
    ) internal {
        uint256 sharesToMint = tokensToShares(_pool, _amount);
        mintShares(_pool, _delegator, sharesToMint);
        _pool.totalStake += _amount;
    }

    /**
     * @notice Unstake an amount of tokens from the pool. Calculates the maount of shares to burn based on the current
        amount of total stake and outstanding shares. Burns the calculated amount of shares from the delegator 
        and subtracts the unstaked amount from the pool's total stake.
     * @param _pool storage pointer to the delegation pool
     * @param _delegator address of the delegator that is unstaking from the pool
     * @param _amount amount of tokens being unstaked by the delegator
     */
    function unstake(
        Pool storage _pool,
        address _delegator,
        uint256 _amount
    ) internal {
        uint256 sharesToBurn = tokensToShares(_pool, _amount);
        burnShares(_pool, _delegator, sharesToBurn);
        _pool.totalStake -= _amount;
    }

    /**
     * @notice Add rewards to the delegation pool, increases the total stake in the pool by the specified amount. 
        Returns the new amount of total stake in the pool.
     * @param _pool storage pointer to the delegation pool
     * @param _amount amount of tokens to add to the total stake
     * @return totalStake new total stake in the delegation pool
     */
    function addRewards(Pool storage _pool, uint256 _amount) internal returns (uint256 totalStake) {
        totalStake = _pool.totalStake + _amount;
        _pool.totalStake = totalStake;
    }

    /**
     * @notice Mint a specified amount of new shares for the delegator.
        Increases the delegator's delegation share amount and total shares.
     * @param _pool storage pointer to the delegation pool
     * @param _delegator address of the delegator to mint shares for
     * @param _amount amount of shares to mint
     * @dev updates totalShares used for stake accounting but not activeFeeShares for fee accounting
     */
    function mintShares(
        Pool storage _pool,
        address _delegator,
        uint256 _amount
    ) internal {
        _pool.delegations[_delegator].shares = _pool.delegations[_delegator].shares + _amount;
        _pool.totalShares = _pool.totalShares + _amount;
    }

    /**
     * @notice Burn existing shares from a delegator. 
        Subtracts the amount of shares to burn from the delegator's delegation and decreases the amount of total shares.
     * @param _pool storage pointer to the delegation pool
     * @param _delegator address of the delegator to burn shares from
     * @param _amount amount of shares to burn
     */
    function burnShares(
        Pool storage _pool,
        address _delegator,
        uint256 _amount
    ) internal {
        _pool.delegations[_delegator].shares = _pool.delegations[_delegator].shares - _amount;
        _pool.totalShares = _pool.totalShares - _amount;
        _pool.activeFeeShares -= _amount;
    }

    /**
     * @notice Add fees to the delegation pool.
        Increases the fees by the specified amount and returns the new total amount of fees earned by the pool.
     * @param _pool storage pointer to the delegation pool
     * @param _amount amount of fees to add to the pool
     * @return fees new total amount of fees in the delegation pool
     */
    function addFees(Pool storage _pool, uint256 _amount) internal returns (uint256 fees) {
        uint256 activeFeeShares = _pool.activeFeeShares;
        _pool.activeFeeShares = _pool.totalShares;
        _pool.CFF += MathUtils.percPoints(_amount, activeFeeShares);
    }

    /**
     * @notice Claim all available fees for a delegator from the delegation pool, returns the claimable amount.
     * @dev This only handles state updates to the delegation pool, 
        actual transferring of funds should be handled by the caller
     * @param _pool storage pointer to the delegation pool
     * @param _delegator address of the delegator to claim fees for
     * @return claimedFees amount of fees claimed
     */
    function claimFees(Pool storage _pool, address _delegator) internal returns (uint256 claimedFees) {
        claimedFees = feesOf(_pool, _delegator);

        // Checkpoint CFF
        _pool.delegations[_delegator].lastCFF = _pool.CFF;
    }

    /**
     * @notice Returns the total stake of a delegator
     * @dev Sum of principal and staking rewards
     * @param _pool storage pointer to the delegation pool
     * @param _delegator address of the delegator
     * @return stake total stake of the delegator
     */
    function stakeOf(Pool storage _pool, address _delegator) internal view returns (uint256 stake) {
        stake = MathUtils.percOf(_pool.totalStake, _pool.delegations[_delegator].shares, _pool.totalShares);
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
     * @notice Returns the amount of claimable fees from a delegation pool for a delegator
     * @param _pool storage pointer to the delegation pool
     * @param _delegator address of the delegator
     * @return fees claimable from the delegation pool for the delegator
     */
    function feesOf(Pool storage _pool, address _delegator) internal view returns (uint256 fees) {
        Delegation storage delegation = _pool.delegations[_delegator];

        uint256 currentCFF = _pool.CFF;

        // If CFF is 0 there are no rewards, return early to avoid division by 0
        if (currentCFF == 0) return 0;

        fees = currentCFF != 0 ? MathUtils.percOf(delegation.shares, currentCFF - delegation.lastCFF) : 0;
    }

    /**
     * @param _pool storage pointer to the delegation pool
     * @param _delegator address of the delegator
     * @return stake of the delegator
     * @return fees claimable from the delegation pool for the delegator
     */
    function stakeAndFeesOf(Pool storage _pool, address _delegator)
        internal
        view
        returns (uint256 stake, uint256 fees)
    {
        Delegation storage delegation = _pool.delegations[_delegator];
        uint256 shares = delegation.shares;
        uint256 totalShares = _pool.totalShares;

        stake = MathUtils.percOf(_pool.totalStake, shares, totalShares);

        uint256 currentCFF = _pool.CFF;

        fees = currentCFF != 0 ? MathUtils.percOf(delegation.shares, currentCFF - delegation.lastCFF) : 0;
    }

    /**
     * @notice Returns the total stake in the delegation pool
     * @param _pool storage pointer to the delegation pool
     * @return total stake in the pool
     */
    function poolTotalStake(Pool storage _pool) internal view returns (uint256) {
        return _pool.totalStake;
    }

    /**
     * @notice Convert an amount of tokens to the nominal amount of shares it represents in the pool
     * @param _pool storage pointer to the delegation pool
     * @param _tokens amount of tokens to calculate share amount for
     * @return shares amount of shares that represent the underlying tokens
     */
    function tokensToShares(Pool storage _pool, uint256 _tokens) internal view returns (uint256 shares) {
        uint256 totalStake = _pool.totalStake;
        uint256 totalShares = _pool.totalShares;

        if (totalStake == 0) {
            return 0;
        }

        if (totalShares == 0) {
            return _tokens;
        }

        shares = MathUtils.percOf(_tokens, totalShares, _pool.totalStake);
    }

    /**
     * @notice Convert an amount of shares to the amount of tokens in the delegation pool it represents
     * @param _pool storage pointer to the delegation pool
     * @param _shares amount of shares to calculate token amount for
     * @return tokens amount of tokens represented by the shares
     */
    function sharesToTokens(Pool storage _pool, uint256 _shares) internal view returns (uint256 tokens) {
        uint256 totalShares = _pool.totalShares;
        if (totalShares == 0) {
            return 0;
        }

        tokens = MathUtils.percOf(_pool.totalStake, _shares, _pool.totalShares);
    }
}
