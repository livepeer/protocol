// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

/**
 * @title RoundsManager interface
 */
interface IRoundsManager {
    // Events
    event NewRound(uint256 indexed round, bytes32 blockHash);

    // Deprecated events
    // These event signatures can be used to construct the appropriate topic hashes to filter for past logs corresponding
    // to these deprecated events.
    // event NewRound(uint256 round)

    // External functions
    function initializeRound() external;

    function lipUpgradeRound(uint256 _lip) external view returns (uint256);

    // Public functions
    function blockNum() external view returns (uint256);

    function blockHash(uint256 _block) external view returns (bytes32);

    function blockHashForRound(uint256 _round) external view returns (bytes32);

    function currentRound() external view returns (uint256);

    function currentRoundStartBlock() external view returns (uint256);

    function currentRoundInitialized() external view returns (bool);

    function currentRoundLocked() external view returns (bool);
}
