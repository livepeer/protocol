// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../../Manager.sol";

contract ManagerFixture is Manager {
    constructor(address controller) Manager(controller) {}

    function checkSchrodingerCat() public view whenSystemPaused returns (string memory) {
        return "alive";
    }
}
