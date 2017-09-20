pragma solidity ^0.4.13;

import "../token/ILivepeerToken.sol";

import "zeppelin-solidity/contracts/token/StandardToken.sol";

contract LivepeerTokenMock is ILivepeerToken {
    bool public approved;

    function setApproved(bool _value) external {
        approved = _value;
    }

    function mint(address _to, uint256 _amount) public returns (bool) {
        return true;
    }

    function allowance(address _owner, address _spender) public constant returns (uint256) {
        return 0;
    }

    function transferFrom(address _from, address _to, uint256 _value) public returns (bool) {
        require(approved);
        return true;
    }

    function approve(address _spender, uint256 _value) public returns (bool) {
        return true;
    }

    function balanceOf(address _who) public constant returns (uint256) {
        return 0;
    }

    function transfer(address _to, uint256 _value) public returns (bool) {
        return true;
    }
}
