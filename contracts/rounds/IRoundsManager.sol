pragma solidity ^0.4.11;

/*
 * @title Interface for RoundsManager
 * TODO: switch to interface type
 */
contract IRoundsManager {
    function currentRound() constant returns (uint256);
    function currentRoundStartBlock() constant returns (uint256);
    function rewardTimeWindowLength() constant returns (uint256);
    function cycleLength() constant returns (uint256);
    function cycleNum() constant returns (uint256);
    function validRewardTimeWindow(uint256 _timeWindowIdx) constant returns (bool);
    function rewardCallsPerYear() constant returns (uint256);
    function currentRoundInitialized() constant returns (bool);
    function initializeRound() returns (bool);
}
