// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/interfaces/IERC5805Upgradeable.sol";

/**
 * @title Interface for BondingCheckpoints
 */
interface IBondingCheckpoints is IERC5805Upgradeable {
    function delegatedAt(address _account, uint256 _timepoint) external view returns (address);

    function checkpointBonding(
        address _account,
        uint256 _startRound,
        uint256 _bondedAmount,
        address _delegateAddress,
        uint256 _delegatedAmount,
        uint256 _lastClaimRound,
        uint256 _lastRewardRound
    ) external;

    function checkpointTotalActiveStake(uint256 _totalStake, uint256 _round) external;

    function hasCheckpoint(address _account) external returns (bool);
}
