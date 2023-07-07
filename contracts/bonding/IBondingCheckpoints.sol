// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/interfaces/IERC6372Upgradeable.sol";

/**
 * @title Interface for BondingCheckpoints
 */
interface IBondingCheckpoints is IERC6372Upgradeable {
    // BondingManager hooks

    function checkpointBondingState(
        address _account,
        uint256 _startRound,
        uint256 _bondedAmount,
        address _delegateAddress,
        uint256 _delegatedAmount,
        uint256 _lastClaimRound,
        uint256 _lastRewardRound
    ) external;

    function checkpointTotalActiveStake(uint256 _totalStake, uint256 _round) external;

    // Historical stake access functions

    function getTotalActiveStakeAt(uint256 _round) external view returns (uint256);

    function getBondingStateAt(address _account, uint256 _round)
        external
        view
        returns (uint256 amount, address delegateAddress);
}
