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
            // Solidity keeps a free memory pointer at position 0x40 in memory
            let freeMemoryPtrPosition := 0x40
            // Load the free memory pointer
            let calldataMemoryOffset := mload(freeMemoryPtrPosition)
            // Update free memory pointer to after memory space we reserve for calldata
            mstore(freeMemoryPtrPosition, add(calldataMemoryOffset, calldatasize))
            // Copy calldata (method signature and params of the call) to memory
            calldatacopy(calldataMemoryOffset, 0x0, calldatasize)

            // Call method on target contract using calldata which is loaded into memory
            let ret := delegatecall(gas, target, calldataMemoryOffset, calldatasize, 0, 0)

            // Load the free memory pointer
            let returndataMemoryOffset := mload(freeMemoryPtrPosition)
            // Update free memory pointer to after memory space we reserve for returndata
            mstore(freeMemoryPtrPosition, add(returndataMemoryOffset, returndatasize))
            // Copy returndata (result of the method invoked by the delegatecall) to memory
            returndatacopy(returndataMemoryOffset, 0x0, returndatasize)

            switch ret
            case 0 {
                // Method call failed - revert
                // Return any error message stored in mem[returndataMemoryOffset..(returndataMemoryOffset + returndatasize)]
                revert(returndataMemoryOffset, returndatasize)
            } default {
                // Return result of method call stored in mem[returndataMemoryOffset..(returndataMemoryOffset + returndatasize)]
                return(returndataMemoryOffset, returndatasize)
            }
        }
    }
}
