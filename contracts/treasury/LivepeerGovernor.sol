// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/governance/GovernorUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorVotesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorVotesQuorumFractionUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorSettingsUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorTimelockControlUpgradeable.sol";

import "../bonding/libraries/EarningsPool.sol";
import "../bonding/libraries/EarningsPoolLIP36.sol";

import "../ManagerProxyTarget.sol";
import "../IController.sol";
import "../rounds/IRoundsManager.sol";
import "./GovernorCountingOverridable.sol";
import "./Treasury.sol";

/**
 * @title LivepeerGovernor
 * @notice Core contract for Livepeer governance, starting as the treasury governor.
 * @dev If we ever add fields to this class or more extensions, make sure to add a storage gap to our custom
 * GovernorCountingOverridable extension.
 */
contract LivepeerGovernor is
    ManagerProxyTarget,
    Initializable,
    GovernorUpgradeable,
    GovernorSettingsUpgradeable,
    GovernorTimelockControlUpgradeable,
    GovernorVotesUpgradeable,
    GovernorVotesQuorumFractionUpgradeable,
    GovernorCountingOverridable
{
    /**
     * @notice TreasuryGovernor constructor. Only invokes constructor of base Manager contract with provided Controller.
     * @dev This constructor will not initialize any state variables besides `controller`. The `initialize` function
     * must be called through the proxy after construction to initialize the contract's state in the proxy contract.
     * @param _controller Address of Controller that this contract will be registered with
     */
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address _controller) Manager(_controller) {
        _disableInitializers();
    }

    /**
     * Initializes the LivepeerGovernor instance. This requires the following contracts to have already been deployed
     * and registered on the controller:
     * - "Treasury"
     * - "BondingVotes"
     * - "PollCreator"
     */
    function initialize(
        uint256 initialVotingDelay,
        uint256 initialVotingPeriod,
        uint256 initialProposalThreshold,
        uint256 initialQuorum,
        uint256 quota
    ) public initializer {
        __Governor_init("LivepeerGovernor");
        __GovernorSettings_init(initialVotingDelay, initialVotingPeriod, initialProposalThreshold);
        __GovernorTimelockControl_init(treasury());

        // The GovernorVotes module will hold a fixed reference to the votes contract. If we ever change its address we
        // need to call the {bumpGovernorVotesTokenAddress} function to update it in here as well.
        __GovernorVotes_init(votes());

        __GovernorVotesQuorumFraction_init(initialQuorum);

        __GovernorCountingOverridable_init(quota);
    }

    /**
     * @dev Overrides the quorum denominator from the GovernorVotesQuorumFractionUpgradeable extension. We use
     * MathUtils.PERC_DIVISOR so that our quorum numerator is a valid MathUtils fraction.
     */
    function quorumDenominator() public view virtual override returns (uint256) {
        return MathUtils.PERC_DIVISOR;
    }

    /**
     * @dev See {GovernorCountingOverridable-votes}.
     */
    function votes() public view override returns (IVotes) {
        return bondingVotes();
    }

    /**
     * @dev This should be called if we ever change the address of the BondingVotes contract. Not a normal flow, but its
     * address could still eventually change in the controller so we provide this function as a future-proof commodity.
     * This is callable by anyone because it always fetches the current address from the controller, so not exploitable.
     */
    function bumpGovernorVotesTokenAddress() external {
        token = votes();
    }

    /**
     * @dev Returns the BondingVotes contract address from the controller.
     */
    function bondingVotes() internal view returns (IVotes) {
        return IVotes(controller.getContract(keccak256("BondingVotes")));
    }

    /**
     * @dev Returns the Treasury contract address from the controller.
     */
    function treasury() internal view returns (Treasury) {
        return Treasury(payable(controller.getContract(keccak256("Treasury"))));
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

    function state(uint256 proposalId)
        public
        view
        override(GovernorUpgradeable, GovernorTimelockControlUpgradeable)
        returns (ProposalState)
    {
        return super.state(proposalId);
    }

    function _execute(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(GovernorUpgradeable, GovernorTimelockControlUpgradeable) {
        super._execute(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(GovernorUpgradeable, GovernorTimelockControlUpgradeable) returns (uint256) {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor()
        internal
        view
        override(GovernorUpgradeable, GovernorTimelockControlUpgradeable)
        returns (address)
    {
        return super._executor();
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(GovernorUpgradeable, GovernorTimelockControlUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
