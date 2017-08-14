pragma solidity ^0.4.13;

import "./Manager.sol";

import "zeppelin-solidity/contracts/lifecycle/Pausable.sol";

contract ContractRegistry is Pausable {
    mapping (bytes32 => address) public registry;

    function ContractRegistry() {
        // Contract starts off in paused state
        pause();
    }

    function setContract(bytes32 _key, address _contract) public onlyOwner whenPaused returns (bool) {
        registry[_key] = _contract;

        return true;
    }

    function updateManagerRegistry(bytes32 _key, address _registry) public onlyOwner whenPaused returns (bool) {
        return Manager(registry[_key]).setRegistry(_registry);
    }
}
