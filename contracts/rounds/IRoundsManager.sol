pragma solidity ^0.4.13;


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
    function roundsPerYear() public constant returns (uint256);
    function currentRoundInitialized() public constant returns (bool);
}
