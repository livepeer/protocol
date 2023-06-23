// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/interfaces/IERC5805Upgradeable.sol";

interface IVotes is IERC5805Upgradeable {
    function delegatedAt(address delegatee, uint256 timepoint) external returns (address);
}
