pragma solidity ^0.4.17;

import "./RoundsManager.sol";


contract AdjustableRoundsManager is RoundsManager {
    uint256 num;

    function AdjustableRoundsManager(address _controller) public RoundsManager(_controller) {}

    function setBlockNum(uint256 _num) external {
        num = _num;
    }

    function mineBlocks(uint256 _blocks) external {
        num += _blocks;
    }

    function blockNum() public view returns (uint256) {
        return num;
    }
}
