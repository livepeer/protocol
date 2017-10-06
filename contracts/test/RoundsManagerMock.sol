pragma solidity ^0.4.13;

import "../rounds/IRoundsManager.sol";
import "../bonding/IBondingManager.sol";
import "../token/IMinter.sol";


contract RoundsManagerMock is IRoundsManager {
    IBondingManager bondingManager;
    IMinter minter;

    uint256 public currentRound;
    uint256 public currentRoundStartBlock;
    uint256 public roundsPerYear;
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

    function setRoundsPerYear(uint256 _rounds) external {
        roundsPerYear = _rounds;
    }

    function initializeRound() external returns (bool) {
        return bondingManager.setActiveTranscoders();
    }

    function callSetCurrentRewardTokens() external {
        minter.setCurrentRewardTokens();
    }

    function currentRound() public constant returns (uint256) {
        return currentRound;
    }

    function currentRoundStartBlock() public constant returns (uint256) {
        return currentRoundStartBlock;
    }

    function roundsPerYear() public constant returns (uint256) {
        return roundsPerYear;
    }

    function currentRoundInitialized() public constant returns (bool) {
        return currentRoundInitialized;
    }
}
