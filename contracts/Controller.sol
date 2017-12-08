pragma solidity ^0.4.17;

import "./IController.sol";
import "./IManager.sol";

import "zeppelin-solidity/contracts/lifecycle/Pausable.sol";


contract Controller is Pausable, IController {
    // Track contract ids and their mapped addresses
    mapping (bytes32 => address) registry;

    function Controller() public {
        // Start system as paused
        paused = true;
    }

    /*
     * @dev Register contract id and mapped address
     * @param _id Contract id (keccak256 hash of contract name)
     * @param _contract Contract address
     */
    function setContract(bytes32 _id, address _contract) external onlyOwner {
        registry[_id] = _contract;

        SetContract(_id, _contract);
    }

    /*
     * @dev Update contract's controller
     * @param _id Contract id (keccak256 hash of contract name)
     * @param _controller Controller address
     */
    function updateController(bytes32 _id, address _controller) external onlyOwner {
        return IManager(registry[_id]).setController(_controller);
    }

    /*
     * @dev Get contract address for an id
     * @param _id Contract id
     */
    function getContract(bytes32 _id) public view returns (address) {
        return registry[_id];
    }
}
