// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/interfaces/IERC5805Upgradeable.sol";

/**
 * @title Interface for BondingCheckpoints
 */
interface IBondingCheckpoints is IERC5805Upgradeable {
    /**
     * @dev Returns the delegate that `account` had chosen in a specific moment in the past.
     */
    function delegatedAt(address _account, uint256 _timepoint) external view returns (address);
}
