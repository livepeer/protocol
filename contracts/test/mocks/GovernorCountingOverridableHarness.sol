// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/governance/GovernorUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorVotesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorVotesQuorumFractionUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorSettingsUpgradeable.sol";

import "../../treasury/GovernorCountingOverridable.sol";

/**
 * @dev This is a concrete contract to test the GovernorCountingOverridable extension. It implements the minimum
 * necessary to get a working Governor to test the extension.
 */
contract GovernorCountingOverridableHarness is
    Initializable,
    GovernorUpgradeable,
    GovernorSettingsUpgradeable,
    GovernorVotesUpgradeable,
    GovernorCountingOverridable
{
    // use non-standard values for these to test if it's really used
    uint256 constant QUOTA = 420000; // 42%
    uint256 constant QUORUM = 370000; // 37%

    IVotes internal iVotes; // 🍎

    function initialize(IVotes _votes) public initializer {
        iVotes = _votes;

        __Governor_init("GovernorCountingOverridableConcrete");
        __GovernorSettings_init(
            0, /* no voting delay */
            100, /* 100 blocks voting period */
            0 /* no minimum proposal threshold */
        );

        __GovernorVotes_init(iVotes);
        __GovernorCountingOverridable_init(QUOTA);
    }

    function votes() public view override returns (IVotes) {
        return iVotes;
    }

    function quorum(uint256 timepoint) public view virtual override returns (uint256) {
        uint256 totalSupply = iVotes.getPastTotalSupply(timepoint);
        return MathUtils.percOf(totalSupply, QUORUM);
    }

    /**
     * @dev Expose internal _quorumReached function for testing.
     */
    function quorumReached(uint256 proposalId) public view returns (bool) {
        return super._quorumReached(proposalId);
    }

    /**
     * @dev Expose internal _voteSucceeded function for testing.
     */
    function voteSucceeded(uint256 proposalId) public view returns (bool) {
        return super._voteSucceeded(proposalId);
    }

    function proposalThreshold()
        public
        view
        override(GovernorUpgradeable, GovernorSettingsUpgradeable)
        returns (uint256)
    {
        return super.proposalThreshold();
    }
}
