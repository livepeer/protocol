pragma solidity ^0.4.25;

import "./GenericMock.sol";

contract MinterMock is GenericMock {

    event TrustedBurnETH(uint256 amount);

    function trustedBurnETH(uint256 _amount) external {
        emit TrustedBurnETH(_amount);
    }
}