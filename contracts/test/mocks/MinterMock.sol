pragma solidity ^0.4.25;

import "./GenericMock.sol";

contract MinterMock is GenericMock {

    event TrustedBurnETH(uint256 amount);
    event TrustedWithdrawETH(address to, uint256 amount);

    function trustedBurnETH(uint256 _amount) external {
        emit TrustedBurnETH(_amount);
    }

    function trustedWithdrawETH(address _to, uint256 _amount) external {
        emit TrustedWithdrawETH(_to, _amount);
    }
}