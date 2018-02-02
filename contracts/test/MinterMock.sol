pragma solidity ^0.4.17;

import "../token/IMinter.sol";
import "../IController.sol";


contract MinterMock is IMinter {
    uint256 reward;

    function setReward(uint256 _amount) external {
        reward = _amount;
    }

    function createReward(uint256 _fracNum, uint256 _fracDenom) external returns (uint256) {
        return reward;
    }

    function trustedTransferTokens(address _to, uint256 _amount) external {}

    function trustedBurnTokens(uint256 _amount) external {}

    function trustedWithdrawETH(address _to, uint256 _amount) external {}

    function depositETH() external payable returns (bool) {
        return true;
    }

    function setCurrentRewardTokens() external {}

    function getController() public view returns (IController) {
        return IController(address(0));
    }
}
