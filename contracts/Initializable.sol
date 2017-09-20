pragma solidity ^0.4.13;


contract Initializable {
    // Contract should only be initialized once
    bool private initialized = false;

    // Check if contract is not initialized
    modifier beforeInitialization() {
        require(!initialized);
        _;
    }

    // Check if contract is initialized
    modifier afterInitialization() {
        require(initialized);
        _;
    }

    /*
     * @dev Return whether contract is initialized
     */
    function isInitialized() public constant returns (bool) {
        return initialized;
    }

    /*
     * @dev Set contract as initialized. Should be called after steps required for initialization
     */
    function finishInitialization() internal beforeInitialization returns (bool) {
        initialized = true;

        return true;
    }
}
