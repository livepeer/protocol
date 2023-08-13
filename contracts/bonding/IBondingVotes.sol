// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/interfaces/IERC6372Upgradeable.sol";

import "../treasury/IVotes.sol";

/**
 * @title Interface for BondingVotes
 */
interface IBondingVotes is IERC6372Upgradeable, IVotes {
    error InvalidCaller(address caller, address required);
    error InvalidCheckpoint(uint256 checkpointRound, uint256 requiredRound);
    error FutureLastClaimRound(uint256 lastClaimRound, uint256 maxAllowed);

    error FutureLookup(uint256 queryRound, uint256 maxAllowed);
    error MissingRoundCheckpoint(uint256 round);
    error NoRecordedCheckpoints();
    error PastLookup(uint256 queryRound, uint256 firstCheckpointRound);
    error MissingEarningsPool(address transcoder, uint256 round);

    // Indicates that the called function is not supported in this contract and should be performed through the
    // BondingManager instead. This is mostly used for IVotes delegation methods which must be bonds instead.
    error MustCallBondingManager(string bondingManagerFunction);

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

    function hasCheckpoint(address _account) external view returns (bool);

    function getTotalActiveStakeAt(uint256 _round) external view returns (uint256);

    function getBondingStateAt(address _account, uint256 _round)
        external
        view
        returns (uint256 amount, address delegateAddress);
}
