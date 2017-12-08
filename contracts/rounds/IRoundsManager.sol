pragma solidity ^0.4.17;


/*
 * @title Interface for RoundsManager
 */
contract IRoundsManager {
    event NewRound(uint256 round);

    // External functions
    function initializeRound() external;

    // Public functions
    function currentRound() public view returns (uint256);
    function currentRoundStartBlock() public view returns (uint256);
    function currentRoundInitialized() public view returns (bool);
    function currentRoundLocked() public view returns (bool);
}
