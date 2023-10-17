// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

interface IBondingManager {
    function checkpointBondingState(address _account) external;
}

/// @custom:security-contact victor@livepeer.org
contract Checkpointer {
    IBondingManager public constant BONDING_MANAGER = IBondingManager(0x35Bcf3c30594191d53231E4FF333E8A770453e40); // mainnet

    function checkpointMany(address[] calldata addresses) public {
        for (uint256 i = 0; i < addresses.length; i++) {
            BONDING_MANAGER.checkpointBondingState(addresses[i]);
        }
    }
}
