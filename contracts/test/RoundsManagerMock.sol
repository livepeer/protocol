pragma solidity ^0.4.17;

import "../rounds/IRoundsManager.sol";
import "../bonding/IBondingManager.sol";
import "../token/IMinter.sol";


contract RoundsManagerMock is IRoundsManager {
    IBondingManager bondingManager;
    IMinter minter;

    uint256 public currentRound;
    uint256 public currentRoundStartBlock;
    bool public currentRoundInitialized;

    function setBondingManager(address _bondingManager) external {
        bondingManager = IBondingManager(_bondingManager);
    }

    function setMinter(address _minter) external {
        minter = IMinter(_minter);
    }

    function setCurrentRound(uint256 _round) external {
        currentRound = _round;
    }

    function setCurrentRoundInitialized(bool _initialized) external {
        currentRoundInitialized = _initialized;
    }

    function initializeRound() external returns (bool) {
        return bondingManager.setActiveTranscoders();
    }

    function callSetCurrentRewardTokens() external {
        minter.setCurrentRewardTokens();
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
}
