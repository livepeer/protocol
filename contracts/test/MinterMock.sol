pragma solidity ^0.4.17;

import "../token/IMinter.sol";


contract MinterMock is IMinter {
    uint256 reward;

    function setReward(uint256 _amount) external {
        reward = _amount;
    }

    function createReward(uint256 _fracNum, uint256 _fracDenom) external returns (uint256) {
        return reward;
    }

    function transferTokens(address _to, uint256 _amount) external {}

    function burnTokens(uint256 _amount) external {}

    function addToRedistributionPool(uint256 _amount) external {}

    function setCurrentRewardTokens() external {}
}
