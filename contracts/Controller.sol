pragma solidity ^0.4.13;

import "./IController.sol";
import "./IManager.sol";

import "zeppelin-solidity/contracts/lifecycle/Pausable.sol";


contract Controller is Pausable, IController {
    // Track contract ids and their mapped addresses
    mapping (bytes32 => address) registry;

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
     * @dev Get contract address for an id
     * @param _id Contract id
     */
    function getContract(bytes32 _id) public constant returns (address) {
        return registry[_id];
    }

    /*
     * @dev Update contract's controller
     * @param _id Contract id (keccak256 hash of contract name)
     * @param _controller Controller address
     */
    function updateController(bytes32 _id, address _controller) external onlyOwner returns (bool) {
        return IManager(registry[_id]).setController(_controller);
    }
}
