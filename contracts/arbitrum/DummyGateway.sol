//SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

contract DummyGateway {
    function calculateL2TokenAddress(address _token) external pure returns (address) {
        return _token;
    }

    function counterpartGateway() external view returns (address) {
        return address(this);
    }
}
