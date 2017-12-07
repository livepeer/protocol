pragma solidity ^0.4.17;


/*
 * @title Interface for RoundsManager
 */
contract IRoundsManager {
    // External functions
    function initializeRound() external returns (bool);

    // Public functions
    function currentRound() public constant returns (uint256);
    function currentRoundStartBlock() public constant returns (uint256);
    function currentRoundInitialized() public constant returns (bool);
}
