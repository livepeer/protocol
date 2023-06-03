// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/utils/Checkpoints.sol";

import "./libraries/EarningsPool.sol";
import "./libraries/EarningsPoolLIP36.sol";

import "../IController.sol";
import "../rounds/IRoundsManager.sol";
import "./BondingCheckpoints.sol";
import "./GovernorVotesBondingCheckpoints.sol";

contract TreasuryGovernor is Governor, GovernorSettings, GovernorVotesBondingCheckpoints {
    constructor(IController _controller, BondingCheckpoints _bondingCheckpoints)
        Governor("TreasuryGovernor")
        GovernorSettings(
            1, /* 1 round/day voting delay */
            10, /* 10 rounds/days voting period */
            100e18 /* 100 LPT min proposal threshold */
        )
        GovernorVotesBondingCheckpoints(_controller, _bondingCheckpoints)
    {}

    function proposalThreshold() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.proposalThreshold();
    }
}
