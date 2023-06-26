// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/governance/GovernorUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorVotesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorVotesQuorumFractionUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorSettingsUpgradeable.sol";

import "../bonding/libraries/EarningsPool.sol";
import "../bonding/libraries/EarningsPoolLIP36.sol";
import "../polling/PollCreator.sol";

import "../ManagerProxyTarget.sol";
import "../IController.sol";
import "../rounds/IRoundsManager.sol";
import "./GovernorCountingOverridable.sol";
import "./BondingCheckpointsVotes.sol";
import "./IVotes.sol";

contract LivepeerGovernor is
    Initializable,
    ManagerProxyTarget,
    GovernorUpgradeable,
    GovernorSettingsUpgradeable,
    GovernorVotesUpgradeable,
    GovernorVotesQuorumFractionUpgradeable,
    GovernorCountingOverridable
{
    /**
     * @notice TreasuryGovernor constructor. Only invokes constructor of base Manager contract with provided Controller address
     * @dev This constructor will not initialize any state variables besides `controller`. The `initialize` function must be called
     * after construction to initialize the contract's state.
     * @param _controller Address of Controller that this contract will be registered with
     */
    constructor(address _controller) Manager(_controller) {}

    function initialize() public initializer {
        __Governor_init("LivepeerGovernor");
        __GovernorSettings_init(
            1, /* 1 round/day voting delay */
            10, /* 10 rounds/days voting period */
            100e18 /* 100 LPT min proposal threshold */
        );

        // The GovernorVotes module will hold a fixed reference to the votes contract. If we ever change its address we
        // need to call the {bumpVotesAddress} function to update it in here as well.
        __GovernorVotes_init(votes());

        // Initialize with the same value from the existing polling system.
        uint256 initialQuorum = pollCreator().QUORUM();
        __GovernorVotesQuorumFraction_init(initialQuorum);

        __GovernorCountingOverridable_init();
    }

    /**
     * @dev Overrides the quorum denominator from the GovernorVotesQuorumFractionUpgradeable extension. We use
     * MathUtils.PERC_DIVISOR so that our quorum numerator is a valid MathUtils fraction.
     */
    function quorumDenominator() public view virtual override returns (uint256) {
        return MathUtils.PERC_DIVISOR;
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

    /**
     * @dev See {GovernorCountingOverridable-votes}.
     */
    function votes() public view override returns (IVotes) {
        return bondingCheckpointVotes();
    }

    /**
     * @dev See {GovernorCountingOverridable-quota}. We use the same QUOTA value from the protocol governance system for
     * now, but can consider changing this in the future (e.g. to make it updateable through proposals).
     */
    function quota() public view override returns (uint256) {
        return pollCreator().QUOTA();
    }

    /**
     * @dev This should be called if we ever change the address of the BondingCheckpointsVotes contract. It is a simple
     * non upgradeable proxy to the BondingCheckpoints not to require any upgrades, but its address could still
     * eventually change in the controller so we provide this function as a future-proof commodity. This function is
     * callable by anyone because always fetch the current address from the controller, so it's not exploitable.
     */
    function bumpVotesAddress() external {
        token = votes();
    }

    function bondingCheckpointVotes() public view returns (BondingCheckpointsVotes) {
        return BondingCheckpointsVotes(controller.getContract(keccak256("BondingCheckpointsVotes")));
    }

    function pollCreator() public view returns (PollCreator) {
        return PollCreator(controller.getContract(keccak256("PollCreator")));
    }
}
