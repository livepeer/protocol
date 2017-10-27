pragma solidity ^0.4.17;

import "./ManagerProxyTarget.sol";


contract ManagerProxy is ManagerProxyTarget {
    function ManagerProxy(address _controller, bytes32 _targetContractId) public Manager(_controller) {
        targetContractId = _targetContractId;
    }

    // Based on https://github.com/AugurProject/augur-core/blob/develop/src/libraries/Delegator.sol
    function() public payable {
        address target = controller.getContract(targetContractId);
        // Target contract must be registered
        require(target > 0);

        assembly {
            // Load the free memory pointer at 0x40
            let calldataMemoryOffset := mload(0x40)
            // Update free memory pointer to after memory space we reserve for calldata
            mstore(0x40, add(calldataMemoryOffset, calldatasize))
            // Copy method signature and params of the call to memory
            calldatacopy(calldataMemoryOffset, 0x0, calldatasize)

            // Call method on target contract and store result starting at calldataMemoryOffset
            let ret := delegatecall(gas, target, calldataMemoryOffset, calldatasize, 0, 0)

            // Load the free memory pointer at 0x40
            let returndataOffset := mload(0x40)
            // Update free memory pointer to after memory space we reserve for returndata
            mstore(0x40, add(returndataOffset, returndatasize))
            // Copy returndata to memory
            returndatacopy(returndataOffset, 0, returndatasize)

            switch ret
            case 0 {
                // Method call failed - revert
                // Return any error message contained in returndata
                revert(returndataOffset, returndatasize)
            } default {
                // Return result of method call stored in mem[returndataOffset..(returndataOffset + returndatasize)]
                return(returndataOffset, returndatasize)
            }
        }
    }
}
