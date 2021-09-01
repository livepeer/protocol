// SPDX-FileCopyrightText: 2021 Livepeer <nico@livepeer.org>
// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

/**
 * @title Interface for BondingManager
 */
interface IBondingManager {
    event OrchestratorUpdate(address indexed orchestrator, uint256 rewardCut, uint256 feeShare);
    event OrchestratorActivated(address indexed orchestrator, uint256 activationRound);
    event OrchestratorDeactivated(address indexed orchestrator, uint256 deactivationRound);
    event Reward(address indexed orchestrator, uint256 amount);

    event Stake(address indexed orchestrator, uint256 amount);
    event Unstake(address indexed orchestrator, uint256 amount);

    event Delegate(address indexed delegator, address indexed orchestrator, uint256 amount);
    event Undelegate(address indexed delegator, address indexed orchestrator, uint256 amount);

    event WithdrawStake(address indexed delegator, uint256 unbondingLockId, uint256 amount, uint256 withdrawRound);
    event WithdrawFees(address indexed delegator);

    // External functions
    function updateOrchestratorWithFees(address _orchestrator, uint256 _fees) external;

    function setCurrentRoundTotalActiveStake() external;

    // Public functions
    function getOrchestratorPoolSize() external view returns (uint256);

    function isActiveOrchestrator(address _orchestrator) external view returns (bool);

    function getTotalBonded() external view returns (uint256);
}
