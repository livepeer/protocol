pragma solidity ^0.4.13;

import "./ContractRegistry.sol";

contract Manager {
    // Registry contract
    address public registry;

    modifier onlyRegistry() {
        require(msg.sender == registry);
        _;
    }

    modifier whenSystemNotPaused() {
        require(!ContractRegistry(registry).paused());
        _;
    }

    modifier whenSystemPaused() {
        require(ContractRegistry(registry).paused());
        _;
    }

    /*
     * @dev Initialize a manager contract with its registry
     * @param _registry Registry contract address
     */
    function Manager(address _registry) {
        registry = _registry;
    }

    /*
     * @dev Set registry contract. Only callable by current registry
     * @param _registry Registry contract address
     */
    function setRegistry(address _registry) onlyRegistry whenSystemPaused public returns (bool) {
        registry = _registry;

        return true;
    }
}
