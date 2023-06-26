// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorVotesQuorumFractionUpgradeable.sol";

import "../bonding/libraries/EarningsPool.sol";
import "../bonding/libraries/EarningsPoolLIP36.sol";

import "../Manager.sol";
import "../IController.sol";
import "../rounds/IRoundsManager.sol";
import "../bonding/IBondingCheckpoints.sol";
import "./IVotes.sol";

/**
 * @title GovernorCountingOverridable
 * @notice Implements the Counting module from OpenZeppelin Governor with support for delegators overriding their
 * delegated transcoder's vote. This module is used through inheritance by the Governor contract.
 */
abstract contract GovernorCountingOverridable is Initializable, GovernorUpgradeable {
    using SafeMath for uint256;

    function __GovernorCountingOverridable_init() internal onlyInitializing {
        __GovernorCountingOverridable_init_unchained();
    }

    function __GovernorCountingOverridable_init_unchained() internal onlyInitializing {}

    /**
     * @dev Supported vote types. Matches Governor Bravo ordering.
     */
    enum VoteType {
        Against,
        For,
        Abstain
    }

    struct ProposalVote {
        uint256 againstVotes;
        uint256 forVotes;
        uint256 abstainVotes;
        mapping(address => bool) hasVoted;
        mapping(address => VoteType) votes;
        // These vote deductions state is only necessary to support the case where a delegator might vote before their
        // transcoder. When that happens, we need to deduct the delegator(s) votes before tallying the transcoder vote.
        // This could be removed if we just require the transcoder to always vote first, tho that can be exploited by a
        // transcoder that doesn't want to get overridden.
        mapping(address => uint256) voteDeductions;
    }

    mapping(uint256 => ProposalVote) private _proposalVotes;

    /**
     * @dev See {IGovernor-COUNTING_MODE}.
     */
    // solhint-disable-next-line func-name-mixedcase
    function COUNTING_MODE() public pure virtual override returns (string memory) {
        // TODO: Figure out the right value for this
        return "support=bravo&quorum=for,abstain";
    }

    /**
     * @dev See {IGovernor-hasVoted}.
     */
    function hasVoted(uint256 proposalId, address account) public view virtual override returns (bool) {
        return _proposalVotes[proposalId].hasVoted[account];
    }

    /**
     * @dev Accessor to the internal vote counts.
     */
    function proposalVotes(uint256 proposalId)
        public
        view
        virtual
        returns (
            uint256 againstVotes,
            uint256 forVotes,
            uint256 abstainVotes
        )
    {
        ProposalVote storage proposalVote = _proposalVotes[proposalId];
        return (proposalVote.againstVotes, proposalVote.forVotes, proposalVote.abstainVotes);
    }

    /**
     * @dev See {Governor-_quorumReached}.
     */
    function _quorumReached(uint256 proposalId) internal view virtual override returns (bool) {
        (uint256 againstVotes, uint256 forVotes, uint256 abstainVotes) = proposalVotes(proposalId);

        uint256 totalVotes = againstVotes.add(forVotes).add(abstainVotes);

        return totalVotes >= quorum(proposalSnapshot(proposalId));
    }

    /**
     * @dev See {Governor-_voteSucceeded}. In this module, the forVotes must be at least QUOTA of the total votes.
     */
    function _voteSucceeded(uint256 proposalId) internal view virtual override returns (bool) {
        (uint256 againstVotes, uint256 forVotes, ) = proposalVotes(proposalId);

        // we ignore abstain votes for vote succeeded calculation
        uint256 totalValidVotes = againstVotes.add(forVotes);

        return forVotes >= MathUtils.percOf(totalValidVotes, quota());
    }

    /**
     * @dev See {Governor-_countVote}. In this module, the support follows the `VoteType` enum (from Governor Bravo).
     */
    function _countVote(
        uint256 proposalId,
        address account,
        uint8 support,
        uint256 weight,
        bytes memory // params
    ) internal virtual override {
        ProposalVote storage proposalVote = _proposalVotes[proposalId];

        require(!proposalVote.hasVoted[account], "GovernorVotingSimple: vote already cast");
        proposalVote.hasVoted[account] = true;
        proposalVote.votes[account] = VoteType(support);

        weight = _handleVoteOverrides(proposalId, proposalVote, account, weight);

        if (support == uint8(VoteType.Against)) {
            proposalVote.againstVotes += weight;
        } else if (support == uint8(VoteType.For)) {
            proposalVote.forVotes += weight;
        } else if (support == uint8(VoteType.Abstain)) {
            proposalVote.abstainVotes += weight;
        } else {
            revert("Votes: invalid value for enum VoteType");
        }
    }

    /**
     * @notice Handles vote overrides that delegators can make to their
     * corresponding delegated transcoder votes. Usually only the transcoders
     * vote on proposals, but any delegator can change their part of the vote.
     * This tracks past votes and deduction on separate mappings in order to
     * calculate the effective voting power of each vote.
     * @param proposalId ID of the proposal being voted on
     * @param proposalVote struct where the vote totals are tallied on
     * @param account current user making a vote
     * @param weight voting weight of the user making the vote
     */
    function _handleVoteOverrides(
        uint256 proposalId,
        ProposalVote storage proposalVote,
        address account,
        uint256 weight
    ) internal returns (uint256) {
        uint256 timepoint = proposalSnapshot(proposalId);
        address delegatee = votes().delegatedAt(account, timepoint);

        bool isTranscoder = account == delegatee;
        if (isTranscoder) {
            // deduce weight from any previous delegators for this transcoder to
            // make a vote
            return weight - proposalVote.voteDeductions[account];
        }

        // this is a delegator, so add a deduction to the delegated transcoder
        proposalVote.voteDeductions[delegatee] += weight;

        if (proposalVote.hasVoted[delegatee]) {
            // this is a delegator overriding its delegated transcoder vote,
            // we need to update the current totals to move the weight of
            // the delegator vote to the right outcome.
            VoteType transcoderSupport = proposalVote.votes[delegatee];

            if (transcoderSupport == VoteType.Against) {
                proposalVote.againstVotes -= weight;
            } else if (transcoderSupport == VoteType.For) {
                proposalVote.forVotes -= weight;
            } else if (transcoderSupport == VoteType.Abstain) {
                proposalVote.abstainVotes -= weight;
            } else {
                revert("Votes: invalid recorded transcoder vote type");
            }
        }

        return weight;
    }

    /**
     * @dev Implement in inheriting contract to provide the voting power provider.
     */
    function votes() public view virtual returns (IVotes);

    /**
     * @dev Implement in inheriting contract to provide quota value to use to decide on proposal success.
     */
    function quota() public view virtual returns (uint256);

    // TODO: add a storage gap? we might have issues with LivepeerGovernor storage layout
}
