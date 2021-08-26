// SPDX-FileCopyrightText: 2021 Livepeer <info@livepeer.org>

// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "./ILivepeerToken.sol";
import "./VariableSupplyToken.sol";

// Livepeer Token
contract LivepeerToken is VariableSupplyToken {
    string public version = "0.1";

    constructor() ERC20("Livepeer Token", "LPT") {}
}
