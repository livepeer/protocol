pragma solidity ^0.4.11;

/*
 * @title Registry mapping keys (hash of contract name) with contract addresses
 */
contract ContractRegistry {
    mapping (bytes32 => address) registry;

    function registrySet(bytes32 _key, address _contract) internal returns (bool) {
        registry[_key] = _contract;

        return true;
    }

    function registryGet(bytes32 _key) internal constant returns (address) {
        return registry[_key];
    }

    function registryContains(bytes32 _key) internal constant returns (bool) {
        return registry[_key] != address(0x0);
    }
}
