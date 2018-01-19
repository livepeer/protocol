pragma solidity ^0.4.17;

import "../rounds/IRoundsManager.sol";
import "../bonding/IBondingManager.sol";
import "../token/IMinter.sol";


contract RoundsManagerMock is IRoundsManager {
    IBondingManager bondingManager;
    IMinter minter;

    uint256 public blockNum;
    bytes32 public blockHash;
    uint256 public currentRound;
    uint256 public currentRoundStartBlock;
    bool public currentRoundInitialized;
    bool public currentRoundLocked;

    function setBondingManager(address _bondingManager) external {
        bondingManager = IBondingManager(_bondingManager);
    }

    function setMinter(address _minter) external {
        minter = IMinter(_minter);
    }

    function mineBlocks(uint256 _blocks) external {
        blockNum += _blocks;
    }

    function setBlockNum(uint256 _blockNum) external {
        blockNum = _blockNum;
    }

    function setCurrentRound(uint256 _round) external {
        currentRound = _round;
    }

    function setCurrentRoundLocked(bool _locked) external {
        currentRoundLocked = _locked;
    }

    function setCurrentRoundInitialized(bool _initialized) external {
        currentRoundInitialized = _initialized;
    }

    function initializeRound() external {
        bondingManager.setActiveTranscoders();
    }

    function callSetCurrentRewardTokens() external {
        minter.setCurrentRewardTokens();
    }

    function blockNum() public view returns (uint256) {
        return blockNum;
    }

    function blockHash(uint256 _block) public view returns (bytes32) {
        return blockHash;
    }

    function currentRound() public view returns (uint256) {
        return currentRound;
    }

    function currentRoundStartBlock() public view returns (uint256) {
        return currentRoundStartBlock;
    }

    function currentRoundInitialized() public view returns (bool) {
        return currentRoundInitialized;
    }

    function currentRoundLocked() public view returns (bool) {
        return currentRoundLocked;
    }
}
