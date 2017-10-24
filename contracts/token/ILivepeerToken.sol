pragma solidity ^0.4.17;

import "zeppelin-solidity/contracts/token/ERC20.sol";


contract ILivepeerToken is ERC20 {
    function mint(address _to, uint256 _amount) public returns (bool);
}
