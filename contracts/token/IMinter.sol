pragma solidity ^0.4.17;


contract IMinter {
    function createReward(uint256 _fracNum, uint256 _fracDenom) external returns (uint256);
    function transferTokens(address _to, uint256 _amount) external returns (bool);
    function addToRedistributionPool(uint256 _amount) external returns (bool);
    function setCurrentRewardTokens() external returns (bool);
}
