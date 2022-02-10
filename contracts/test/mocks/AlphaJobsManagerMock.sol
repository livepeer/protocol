// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

contract AlphaJobsManagerMock {
    struct Broadcaster {
        uint256 deposit;
        uint256 withdrawBlock;
    }

    mapping(address => Broadcaster) internal mockBroadcasters;

    function setBroadcaster(
        address _addr,
        uint256 _deposit,
        uint256 _withdrawBlock
    ) external {
        mockBroadcasters[_addr].deposit = _deposit;
        mockBroadcasters[_addr].withdrawBlock = _withdrawBlock;
    }

    function broadcasters(address _addr) public view returns (uint256 deposit, uint256 withdrawBlock) {
        deposit = mockBroadcasters[_addr].deposit;
        withdrawBlock = mockBroadcasters[_addr].withdrawBlock;
    }
}
