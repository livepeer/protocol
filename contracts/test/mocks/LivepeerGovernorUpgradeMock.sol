// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../../treasury/LivepeerGovernor.sol";

contract LivepeerGovernorUpgradeMock is LivepeerGovernor {
    uint256 public customField;

    constructor(address _controller) LivepeerGovernor(_controller) {}

    function setCustomField(uint256 _customField) external {
        customField = _customField;
    }
}
