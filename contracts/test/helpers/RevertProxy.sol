// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

contract RevertProxy {
    bytes data;

    fallback() external {
        data = msg.data;
    }

    // solium-disable security/no-low-level-calls
    function execute(address _target) external returns (bool) {
        (bool ok, ) = _target.call(data);
        return ok;
    }
}
