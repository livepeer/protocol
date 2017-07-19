pragma solidity ^0.4.11;

import "./ContractRegistry.sol";

import "../installed_contracts/zeppelin/contracts/ownership/Ownable.sol";

contract LivepeerProtocol is ContractRegistry, Ownable {
    bytes32 public constant roundsManagerKey = keccak256(0x00, 0x01);
    bytes32 public constant bondingManagerKey = keccak256(0x00, 0x02);
    bytes32 public constant jobsManagerKey = keccak256(0x00, 0x03);

    function getRegistryContract(bytes32 _key) constant returns (address) {
        return registryGet(_key);
    }

    function setRegistryContract(bytes32 _key, address _contract) onlyOwner returns (bool) {
        return registrySet(_key, _contract);
    }

    // CONTROLLER ADMIN

    function updateController(bytes32 _key, address _controller) onlyOwner returns (bool) {
        // Check if key is in registry
        if (!registryContains(_key)) throw;

        return registryGet(_key).call(bytes4(keccak256("setController(address)")), _controller);
    }
}
