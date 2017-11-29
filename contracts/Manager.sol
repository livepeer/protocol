pragma solidity ^0.4.17;

import "./IManager.sol";
import "./IController.sol";


contract Manager is IManager {
    // Controller that contract is registered with
    IController public controller;

    bool public paused = false;

    event Pause();
    event Unpause();

    modifier onlyController() {
        require(msg.sender == address(controller));
        _;
    }

    modifier onlyAuthorized() {
        require(isAuthorized(msg.sender, msg.sig));
        _;
    }

    // Check if controller and contract are not paused
    modifier whenSystemNotPaused() {
        require(!controller.paused() && !paused);
        _;
    }

    // Check if controller or contract are paused
    modifier whenSystemPaused() {
        require(controller.paused() || paused);
        _;
    }

    function Manager(address _controller) {
        controller = IController(_controller);
    }

    /*
     * @dev Pause contract. Only callable by controller owner
     */
    function pause() public onlyAuthorized whenSystemNotPaused {
        paused = true;

        Pause();
    }

    /*
     * @dev Unpause contract. Only callable by controller owner
     */
    function unpause() public onlyAuthorized whenSystemPaused {
        paused = false;

        Unpause();
    }

    /*
     * @dev Set controller. Only callable by current controller
     * @param _controller Controller contract address
     */
    function setController(address _controller) external onlyController returns (bool) {
        controller = IController(_controller);

        return true;
    }

    /*
     * @dev Check if caller is authorized and has the function permission for this contract
     * @param _src Source address (caller)
     * @param _sig Function signature at this contract
     */
    function isAuthorized(address _src, bytes4 _sig) internal view returns (bool) {
        // Check if controller contains a permission for the caller
        return controller.hasPermission(_src, address(this), _sig);
    }
}
