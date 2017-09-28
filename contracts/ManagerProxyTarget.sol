pragma solidity ^0.4.13;

import "./Initializable.sol";
import "./Manager.sol";


contract ManagerProxyTarget is Initializable, Manager {
    // Used to look up target contract address in controller's registry
    bytes32 public targetContractId;
}
