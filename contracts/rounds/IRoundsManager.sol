pragma solidity ^0.4.11;

/*
 * @title Interface for RoundsManager
 * TODO: switch to interface type
 */
contract IRoundsManager {
    // External functions
    function initializeRound() external returns (bool);

    // Public functions
    function currentRound() public constant returns (uint256);
    function currentRoundStartBlock() public constant returns (uint256);
    function rewardTimeWindowLength() public constant returns (uint256);
    function cycleLength() public constant returns (uint256);
    function cycleNum() public constant returns (uint256);
    function validRewardTimeWindow(uint256 _timeWindowIdx) public constant returns (bool);
    function rewardCallsPerYear() public constant returns (uint256);
    function currentRoundInitialized() public constant returns (bool);
}
