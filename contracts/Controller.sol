pragma solidity ^0.4.17;

import "./IController.sol";
import "./IManager.sol";

import "zeppelin-solidity/contracts/lifecycle/Pausable.sol";


contract Controller is Pausable, IController {
    // Track contract ids and their mapped addresses
    mapping (bytes32 => address) registry;
    // Track function permissions on registered contracts
    mapping (address => mapping (address => mapping (bytes4 => bool))) permissions;

    function Controller() public {
        // Start system as paused
        paused = true;
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
     * @dev Update contract's controller
     * @param _id Contract id (keccak256 hash of contract name)
     * @param _controller Controller address
     */
    function updateController(bytes32 _id, address _controller) external onlyOwner returns (bool) {
        return IManager(registry[_id]).setController(_controller);
    }

    /*
     * @dev Add a function permission for a contract
     * @param _src Source address (caller)
     * @param _target Target address (contract called)
     * @param _sig Function signature at target address
     */
    function addPermission(address _src, address _target, bytes4 _sig) external onlyOwner {
        permissions[_src][_target][_sig] = true;
    }

    /*
     * @dev Revoke a function permission for a contract
     * @param _src Source address (caller)
     * @param _target Target address (contract called)
     * @param _sig Function signature at target address
     */
    function revokePermission(address _src, address _target, bytes4 _sig) external onlyOwner {
        permissions[_src][_target][_sig] = false;
    }

    /*
     * @dev Returns whether a caller has a function permission for a contract
     * @param _src Source address (caller)
     * @param _target Target address (contract called)
     * @param _sig Function signature at target address
     */
    function hasPermission(address _src, address _target, bytes4 _sig) public view returns (bool) {
        return permissions[_src][_target][_sig];
    }

    /*
     * @dev Get contract address for an id
     * @param _id Contract id
     */
    function getContract(bytes32 _id) public view returns (address) {
        return registry[_id];
    }
}
