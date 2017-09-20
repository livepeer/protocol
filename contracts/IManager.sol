pragma solidity ^0.4.13;


contract IManager {
    function setController(address _controller) external returns (bool);
}
