pragma solidity ^0.4.13;

import "../token/ILivepeerToken.sol";


contract LivepeerTokenMock is ILivepeerToken {
    function mint(address _to, uint256 _amount) returns (bool) {
        return true;
    }
}
