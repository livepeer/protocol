// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

contract SetUint256 {
    uint256 public i;
    bool shouldFail;

    function setUint256(uint256 _i) public payable {
        if (shouldFail) {
            revert("I should fail");
        }
        i = _i;
    }

    function setShouldFail(bool _shouldFail) public {
        shouldFail = _shouldFail;
    }
}
