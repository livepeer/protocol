pragma solidity ^0.4.17;

import "../token/ILivepeerToken.sol";

import "zeppelin-solidity/contracts/token/StandardToken.sol";


contract LivepeerTokenMock is ILivepeerToken {
    bool public approved;
    address public mintedTo;
    uint256 public minted;

    function setApproved(bool _value) external {
        approved = _value;
    }

    function mint(address _to, uint256 _amount) public returns (bool) {
        mintedTo = _to;
        minted = _amount;
    }

    function allowance(address _owner, address _spender) public view returns (uint256) {
        return 0;
    }

    function transferFrom(address _from, address _to, uint256 _value) public returns (bool) {
        require(approved);
        return true;
    }

    function approve(address _spender, uint256 _value) public returns (bool) {
        return true;
    }

    function balanceOf(address _who) public view returns (uint256) {
        return 0;
    }

    function transfer(address _to, uint256 _value) public returns (bool) {
        return true;
    }

    function setTotalSupply(uint256 _totalSupply) external {
        totalSupply = _totalSupply;
    }
}
