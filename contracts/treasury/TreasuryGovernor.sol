// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/utils/Checkpoints.sol";

import "../bonding/libraries/EarningsPool.sol";
import "../bonding/libraries/EarningsPoolLIP36.sol";

import "../ManagerProxyTarget.sol";
import "../IController.sol";
import "../rounds/IRoundsManager.sol";
import "../bonding/BondingCheckpoints.sol";
import "./GovernorVotesBondingCheckpoints.sol";

contract TreasuryGovernor is ManagerProxyTarget, Governor, GovernorSettings, GovernorVotesBondingCheckpoints {
    constructor(address _controller)
        Manager(_controller)
        Governor("TreasuryGovernor")
        GovernorSettings(
            1, /* 1 round/day voting delay */
            10, /* 10 rounds/days voting period */
            100e18 /* 100 LPT min proposal threshold */
        )
        GovernorVotesBondingCheckpoints()
    {}

    function proposalThreshold() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.proposalThreshold();
    }
}
