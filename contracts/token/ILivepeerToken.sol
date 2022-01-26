pragma solidity ^0.5.11;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";

contract ILivepeerToken is ERC20 {
    function mint(address _to, uint256 _amount) external;

    function burn(uint256 _amount) public;
}
