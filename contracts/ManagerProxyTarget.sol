pragma solidity ^0.4.17;

import "./Manager.sol";


contract ManagerProxyTarget is Manager {
    // Used to look up target contract address in controller's registry
    bytes32 public targetContractId;
}
