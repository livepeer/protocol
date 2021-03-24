pragma solidity ^0.5.11;

import "../IController.sol";


/**
 * @title InflationManager interface
 */
contract IInflationManager {
    // Events
    event SetCurrentRewardTokens(uint256 currentMintableTokens, uint256 currentInflation);

    // External functions
    function createReward(uint256 _fracNum, uint256 _fracDenom) external returns (uint256);
    function setCurrentRewardTokens() external;
    function currentMintableTokens() external view returns (uint256);
    function nextMintableTokens() external view returns (uint256);
    function currentMintedTokens() external view returns (uint256);
}
