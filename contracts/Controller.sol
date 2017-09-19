pragma solidity ^0.4.13;

import "./IControlled.sol";

import "zeppelin-solidity/contracts/lifecycle/Pausable.sol";


contract Controller is Pausable, IController {
    // Track contract ids and their mapped addresses
    mapping (bytes32 => address) public registry;

    // Track contract addresses and their whitelisted callers
    mapping (address => mapping (address => bool)) whitelistedCallers;

    function Controller() {
        // Start in paused state
        pause();
    }

    /*
     * @dev Register contract id and mapped address
     * @param _id Contract id (keccak256 hash of contract name)
     * @param _contract Contract address
     */
    function setContract(bytes32 _id, address _contract) external onlyOwner returns (bool) {
        registry[_id] = _contract;

        return true;
    }

    /*
     * @dev Update controlled contract's controller
     * @param _id Contract id (keccak256 hash of contract name)
     * @param _controller Controller address
     */
    function updateContractController(bytes32 _id, address _controller) external onlyOwner returns (bool) {
        return IControlled(registry[_id]).setController(_controller);
    }

    /*
     * @dev Check if a caller is whitelisted for a target contract
     * @param _target Target contract address
     * @param _caller Caller address
     */
    function isWhitelistedCaller(address _target, address _caller) public constant returns (bool) {
        return whitelistedCallers[_target][_caller];
    }
}
