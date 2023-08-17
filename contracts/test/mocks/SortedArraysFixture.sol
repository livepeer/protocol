// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../../bonding/libraries/SortedArrays.sol";

contract SortedArraysFixture {
    uint256[] public array;

    function findLowerBound(uint256 val) external view returns (uint256) {
        return SortedArrays.findLowerBound(array, val);
    }

    function pushSorted(uint256 val) external {
        SortedArrays.pushSorted(array, val);
    }

    function length() external view returns (uint256) {
        return array.length;
    }
}
