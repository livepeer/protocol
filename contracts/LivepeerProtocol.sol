pragma solidity ^0.4.11;

import "./Controllable.sol";
import "./ContractRegistry.sol";

import "../installed_contracts/zeppelin/contracts/ownership/Ownable.sol";

contract LivepeerProtocol is ContractRegistry, Ownable {
    bytes32 public constant roundsManagerKey = keccak256("RoundsManager");
    bytes32 public constant bondingManagerKey = keccak256("BondingManager");
    bytes32 public constant jobsManagerKey = keccak256("JobsManager");

    modifier onlyControllableContract(address _contract) {
        if (!Controllable(_contract).isControllable()) throw;
        _;
    }

    function getRegistryContract(bytes32 _key) public constant returns (address) {
        return registryGet(_key);
    }

    function setRegistryContract(bytes32 _key, address _contract) onlyOwner onlyControllableContract(_contract) public returns (bool) {
        return registrySet(_key, _contract);
    }

    // CONTROLLER ADMIN

    /*
     * @dev Update the controller contract for a registered contract
     * @param _key Key for registered contract
     * @param _controller Address of new controller contract for registered contract
     */
    function updateController(bytes32 _key, address _controller) onlyOwner public returns (bool) {
        // Check if key is in registry
        if (!registryContains(_key)) throw;
        // Check if setting new controller succeeded
        // If the contract is not Controllable, this call will fail
        if (!Controllable(registryGet(_key)).setController(_controller)) throw;

        return true;
    }
}
