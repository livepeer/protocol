// SPDX-FileCopyrightText: 2021 Livepeer <info@livepeer.org>

// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ILivepeerToken is IERC20 {
    function mint(address _to, uint256 _amount) external returns (bool);

    function burn(uint256 _amount) external;

    function transferOwnership(address newOwner) external;
}
