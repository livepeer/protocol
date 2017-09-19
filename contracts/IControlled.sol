pragma solidity ^0.4.13;


contract IControlled {
    function setController(address _controller) external returns (bool);
}
