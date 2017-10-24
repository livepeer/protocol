pragma solidity ^0.4.17;


contract IManager {
    function setController(address _controller) external returns (bool);
}
