// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/interfaces/IERC5805Upgradeable.sol";

interface IVotes is IERC5805Upgradeable {
    /**
     * @dev Emitted when bonding change results in changes to a delegator's number of votes. This complements the events
     * from IERC5805 by also supporting voting power for the delegators themselves.
     */
    event DelegatorVotesChanged(address indexed delegate, uint256 previousBalance, uint256 newBalance);

    function delegatedAt(address account, uint256 timepoint) external returns (address);
}
