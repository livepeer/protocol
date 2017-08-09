pragma solidity ^0.4.13;

import "./Manager.sol";

import "zeppelin-solidity/contracts/lifecycle/Pausable.sol";

contract Registry is Pausable {
    mapping (bytes32 => address) public registry;

    function setContract(bytes32 _key, address _contract) onlyOwner public returns (bool) {
        registry[_key] = _contract;

        return true;
    }

    function updateManagerRegistry(bytes32 _key, address _registry) onlyOwner whenPaused public returns (bool) {
        return Manager(registry[_key]).setRegistry(_registry);
    }
}
