// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./GenericMock.sol";

contract MinterMock is GenericMock {
    event TrustedWithdrawETH(address to, uint256 amount);

    function trustedWithdrawETH(address _to, uint256 _amount) external {
        emit TrustedWithdrawETH(_to, _amount);
    }
}
