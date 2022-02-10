// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./RoundsManager.sol";

contract AdjustableRoundsManager is RoundsManager {
    uint256 public num;
    bytes32 public hash;

    constructor(address _controller) RoundsManager(_controller) {}

    function setBlockNum(uint256 _num) external {
        num = _num;
    }

    function setBlockHash(bytes32 _hash) external {
        hash = _hash;
    }

    function mineBlocks(uint256 _blocks) external {
        num += _blocks;
    }

    function blockNum() public view override returns (uint256) {
        return num;
    }

    function blockHash(uint256 _block) public view override returns (bytes32) {
        require(_block >= blockNum() - 256);

        return hash;
    }
}
