pragma solidity ^0.4.13;

import "./Controlled.sol";


contract Proxy is Controlled {
    function Proxy(address _controller, bytes32 _contractId) Controlled(_controller, _contractId) {}

    // Based on https://github.com/AugurProject/augur-core/blob/develop/src/libraries/Delegator.sol
    function() public payable {
        // Set size of method call result
        // Only allow fixed return size of 32 for now until
        // we can use the RETURNDATACOPY and RETURNDATASIZE opcodes introduced
        // in the Byzantium hard fork
        uint32 size = 32;
        address target = controller.registry(contractId);
        // Target contract must be registered
        require(target > 0);

        assembly {
            // Load the free memory pointer at 0x40
            let calldataMemoryOffset := mload(0x40)
            // Set size of reserved memory space for calldata and method call results
            // Reserved memory size = max(calldatasize, size) so we can always
            // use the space for loading calldata and then reusing the space
            // to load method call results
            let reservedSize := 0
            switch gt(calldatasize, size)
            case 1 {
                reservedSize := calldatasize
            } default {
                reservedSize := size
            }
            // Update free memory pointer to after memory space we reserve for calldata and method call results
            mstore(0x40, add(calldataMemoryOffset, reservedSize))

            // Copy method signature and params of the call to memory
            calldatacopy(calldataMemoryOffset, 0x0, calldatasize)
            // Call method on target contract and store result starting at calldataMemoryOffset
            let ret := delegatecall(gas, target, calldataMemoryOffset, calldatasize, calldataMemoryOffset, size)
            switch ret
            case 0 {
                // Method call failed - revert
                revert(0, 0)
            } default {
                // Return result of method call stored in mem[calldataMemoryOffset..(calldataMemoryOffset + size)]
                return(_calldataMemoryOffset, size)
            }
        }
    }
}
