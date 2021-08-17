// SPDX-FileCopyrightText: 2021 Livepeer <info@livepeer.org>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.4;

import "./MintableToken.sol";

abstract contract VariableSupplyToken is MintableToken {
    event Burn(address indexed burner, uint256 value);

    /**
     * @dev Burns a specific amount of the sender's tokens
     * @param _amount The amount of tokens to be burned
     */
    function burn(uint256 _amount) public {
        _burn(msg.sender, _amount);
        emit Burn(msg.sender, _amount);
    }
}
