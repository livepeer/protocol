pragma solidity ^0.4.13;

import "./IManager.sol";
import "./IController.sol";


contract Manager is IManager {
    // Controller that contract is registered with
    IController public controller;

    // Check if sender is the controller
    modifier onlyController() {
        require(IController(msg.sender) == controller);
        _;
    }

    // Check if controller is not paused
    modifier whenSystemNotPaused() {
        require(!controller.paused());
        _;
    }

    // Check if controller is paused
    modifier whenSystemPaused() {
        require(!controller.paused());
        _;
    }

    function Manager(address _controller) {
        controller = IController(_controller);
    }

    /*
     * @dev Set controller. Only callable by current controller
     * @param _controller Controller contract address
     */
    function setController(address _controller) external onlyController returns (bool) {
        controller = IController(_controller);

        return true;
    }
}
