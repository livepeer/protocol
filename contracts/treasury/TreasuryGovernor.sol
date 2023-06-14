// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/governance/GovernorUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorSettingsUpgradeable.sol";

import "../bonding/libraries/EarningsPool.sol";
import "../bonding/libraries/EarningsPoolLIP36.sol";

import "../ManagerProxyTarget.sol";
import "../IController.sol";
import "../rounds/IRoundsManager.sol";
import "../bonding/BondingCheckpoints.sol";
import "./GovernorVotesBondingCheckpoints.sol";

contract TreasuryGovernor is
    Initializable,
    ManagerProxyTarget,
    GovernorUpgradeable,
    GovernorSettingsUpgradeable,
    GovernorVotesBondingCheckpoints
{
    // 33.33% perc points compatible with MathUtils
    uint256 public constant INITIAL_QUORUM = 333300;

    /**
     * @notice TreasuryGovernor constructor. Only invokes constructor of base Manager contract with provided Controller address
     * @dev This constructor will not initialize any state variables besides `controller`. The `initialize` function must be called
     * after construction to initialize the contract's state.
     * @param _controller Address of Controller that this contract will be registered with
     */
    constructor(address _controller) Manager(_controller) {}

    function initialize() public initializer {
        __Governor_init("LivepeerTreasuryGovernor");
        __GovernorSettings_init(
            1, /* 1 round/day voting delay */
            10, /* 10 rounds/days voting period */
            100e18 /* 100 LPT min proposal threshold */
        );
        __GovernorVotesBondingCheckpoints_init(INITIAL_QUORUM);
    }

    // The following functions are overrides required by Solidity.

    function proposalThreshold()
        public
        view
        override(GovernorUpgradeable, GovernorSettingsUpgradeable)
        returns (uint256)
    {
        return super.proposalThreshold();
    }
}
