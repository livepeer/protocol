// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/interfaces/IERC5805Upgradeable.sol";

interface IVotes is IERC5805Upgradeable {
    function totalSupply() external view returns (uint256);

    function delegatedAt(address account, uint256 timepoint) external returns (address);

    // ERC-20 metadata functions that improve compatibility with tools like Tally

    function name() external view returns (string memory);

    function symbol() external view returns (string memory);

    function decimals() external view returns (uint8);
}
