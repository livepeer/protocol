pragma solidity ^0.4.13;

import "../rounds/IRoundsManager.sol";
import "../bonding/IBondingManager.sol";

contract RoundsManagerMock is IRoundsManager {
    uint256 public mockCurrentRound;
    uint256 public mockCurrentRoundStartBlock;
    uint256 public mockRewardCallsPerYear;
    bool public mockCurrentRoundInitialized;

    IBondingManager bondingManager;

    function RoundsManagerMock(address _bondingManager) {
        bondingManager = IBondingManager(_bondingManager);
    }

    function setCurrentRound(uint256 _round) external returns (bool) {
        mockCurrentRound = _round;
        return true;
    }

    function setCurrentRoundInitialized(bool _initialized) external returns (bool) {
        mockCurrentRoundInitialized = _initialized;
        return true;
    }

    function initializeRound() external returns (bool) {
        return bondingManager.setActiveTranscoders();
    }

    function currentRound() public constant returns (uint256) {
        return mockCurrentRound;
    }

    function currentRoundStartBlock() public constant returns (uint256) {
        return mockCurrentRoundStartBlock;
    }

    function rewardCallsPerYear() public constant returns (uint256) {
        return mockRewardCallsPerYear;
    }

    function currentRoundInitialized() public constant returns (bool) {
        return mockCurrentRoundInitialized;
    }
}
