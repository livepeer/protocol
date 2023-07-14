// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/interfaces/IERC6372Upgradeable.sol";

/**
 * @title Interface for BondingCheckpoints
 */
interface IBondingCheckpoints is IERC6372Upgradeable {
    // BondingManager hooks

    error InvalidCaller(address caller, address required);
    error FutureCheckpoint(uint256 checkpointRound, uint256 maxAllowed);
    error FutureLastClaimRound(uint256 lastClaimRound, uint256 maxAllowed);

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

    error FutureLookup(uint256 queryRound, uint256 currentRound);
    error MissingRoundCheckpoint(uint256 round);
    error NoRecordedCheckpoints();
    error PastLookup(uint256 queryRound, uint256 firstCheckpointRound);
    error MissingEarningsPool(address transcoder, uint256 round);

    function hasCheckpoint(address _account) external view returns (bool);

    function getTotalActiveStakeAt(uint256 _round) external view returns (uint256);

    function getBondingStateAt(address _account, uint256 _round)
        external
        view
        returns (uint256 amount, address delegateAddress);
}
