pragma solidity ^0.4.11;

import "../installed_contracts/zeppelin/contracts/ownership/Ownable.sol";

contract Controllable is Ownable {
    // Controller contract
    address public controller;

    modifier onlyController() {
        // Check if sender is controller
        if (msg.sender != controller) throw;
        _;
    }

    /*
     * @dev Initialize a controllable contract with its controller
     * @param _controller Controller contract address
     */
    function initialize(address _controller) onlyOwner public returns (bool) {
        // Check if contract already has a controller
        if (controller != address(0x0)) throw;

        controller = _controller;

        return true;
    }

    /*
     * @dev Set controller contract. Only callable by current controller
     * @param _controller Controller contract address
     */
    function setController(address _controller) onlyController public returns (bool) {
        controller = _controller;

        return true;
    }
}
