// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/governance/GovernorUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/interfaces/IERC5805Upgradeable.sol";

import "../bonding/libraries/EarningsPool.sol";
import "../bonding/libraries/EarningsPoolLIP36.sol";

import "../Manager.sol";
import "../IController.sol";
import "../rounds/IRoundsManager.sol";
import "./IVotes.sol";

/**
 * @title GovernorCountingOverridable
 * @notice Implements the Counting module from OpenZeppelin Governor with support for delegators overriding their
 * delegated transcoder's vote. This module is used through inheritance by the Governor contract, which must implement
 * the `votes()` function to provide an instance of the IVotes interface.
 */
abstract contract GovernorCountingOverridable is Initializable, GovernorUpgradeable {
    error InvalidVoteType(uint8 voteType);
    error VoteAlreadyCast();

    /**
     * @dev Supported vote types. Matches Governor Bravo ordering.
     */
    enum VoteType {
        Against,
        For,
        Abstain
    }

    /**
     * @dev Tracks state of specicic voters in a single proposal.
     */
    struct ProposalVoterState {
        bool hasVoted;
        VoteType support;
        // This vote deductions state is only necessary to support the case where a delegator might vote before their
        // transcoder. When that happens, we need to deduct the delegator(s) votes before tallying the transcoder vote.
        uint256 deductions;
    }

    /**
     * @dev Tracks the tallying state for a proposal vote counting logic.
     */
    struct ProposalTally {
        uint256 againstVotes;
        uint256 forVotes;
        uint256 abstainVotes;
        mapping(address => ProposalVoterState) voters;
    }

    // Maps proposal IDs to their corresponding vote tallies.
    mapping(uint256 => ProposalTally) private _proposalTallies;

    /**
     * @notice The required percentage of "for" votes in relation to the total opinionated votes (for and against) for
     * a proposal to succeed. Represented as a MathUtils percentage value (e.g. 6 decimal places).
     */
    uint256 public quota;

    function __GovernorCountingOverridable_init(uint256 _quota) internal onlyInitializing {
        __GovernorCountingOverridable_init_unchained(_quota);
    }

    function __GovernorCountingOverridable_init_unchained(uint256 _quota) internal onlyInitializing {
        quota = _quota;
    }

    /**
     * @dev See {IGovernor-COUNTING_MODE}.
     */
    // solhint-disable-next-line func-name-mixedcase
    function COUNTING_MODE() public pure virtual override returns (string memory) {
        return "support=bravo&quorum=for,abstain,against";
    }

    /**
     * @dev See {IGovernor-hasVoted}.
     */
    function hasVoted(uint256 _proposalId, address _account) public view virtual override returns (bool) {
        return _proposalTallies[_proposalId].voters[_account].hasVoted;
    }

    /**
     * @dev Accessor to the internal vote counts.
     */
    function proposalVotes(uint256 _proposalId)
        public
        view
        virtual
        returns (
            uint256 againstVotes,
            uint256 forVotes,
            uint256 abstainVotes
        )
    {
        ProposalTally storage tally = _proposalTallies[_proposalId];
        return (tally.againstVotes, tally.forVotes, tally.abstainVotes);
    }

    /**
     * @dev See {Governor-_quorumReached}.
     */
    function _quorumReached(uint256 _proposalId) internal view virtual override returns (bool) {
        (uint256 againstVotes, uint256 forVotes, uint256 abstainVotes) = proposalVotes(_proposalId);

        uint256 totalVotes = againstVotes + forVotes + abstainVotes;

        return totalVotes >= quorum(proposalSnapshot(_proposalId));
    }

    /**
     * @dev See {Governor-_voteSucceeded}. In this module, the forVotes must be at least QUOTA of the total votes.
     */
    function _voteSucceeded(uint256 _proposalId) internal view virtual override returns (bool) {
        (uint256 againstVotes, uint256 forVotes, ) = proposalVotes(_proposalId);

        // We ignore abstain votes for vote succeeded calculation
        uint256 opinionatedVotes = againstVotes + forVotes;

        return forVotes >= MathUtils.percOf(opinionatedVotes, quota);
    }

    /**
     * @dev See {Governor-_countVote}. In this module, the support follows the `VoteType` enum (from Governor Bravo).
     */
    function _countVote(
        uint256 _proposalId,
        address _account,
        uint8 _supportInt,
        uint256 _weight,
        bytes memory // params
    ) internal virtual override {
        if (_supportInt > uint8(VoteType.Abstain)) {
            revert InvalidVoteType(_supportInt);
        }
        VoteType support = VoteType(_supportInt);

        ProposalTally storage tally = _proposalTallies[_proposalId];
        ProposalVoterState storage voter = tally.voters[_account];

        if (voter.hasVoted) {
            revert VoteAlreadyCast();
        }
        voter.hasVoted = true;
        voter.support = support;

        _weight = _handleVoteOverrides(_proposalId, tally, voter, _account, _weight);

        if (support == VoteType.Against) {
            tally.againstVotes += _weight;
        } else if (support == VoteType.For) {
            tally.forVotes += _weight;
        } else {
            tally.abstainVotes += _weight;
        }
    }

    /**
     * @notice Handles vote overrides that delegators can make to their
     * corresponding delegated transcoder votes. Usually only the transcoders
     * vote on proposals, but any delegator can change their part of the vote.
     * This tracks past votes and deduction on separate mappings in order to
     * calculate the effective voting power of each vote.
     * @param _proposalId ID of the proposal being voted on
     * @param _tally struct where the vote totals are tallied on
     * @param _voter struct where the specific voter state is tracked
     * @param _account current user making a vote
     * @param _weight voting weight of the user making the vote
     */
    function _handleVoteOverrides(
        uint256 _proposalId,
        ProposalTally storage _tally,
        ProposalVoterState storage _voter,
        address _account,
        uint256 _weight
    ) internal returns (uint256) {
        uint256 timepoint = proposalSnapshot(_proposalId);
        address delegate = votes().delegatedAt(_account, timepoint);

        // Notice that we don't need to check if the voting power is greater than zero to trigger the override logic
        // here, which would be the equivalent of the `bondedAmount > 0` check in {BondingVotes-isRegisteredTranscoder}.
        // This is because if the account has zero `bondedAmount`, then it and all its delegators will also have zero
        // voting power, meaning the `votes()` invariant still holds (`0 >= sum(N*0)`).
        bool isSelfDelegated = _account == delegate;
        if (isSelfDelegated) {
            // Deduce weight from any previous delegators for this self-delegating account to cast a vote.
            return _weight - _voter.deductions;
        }

        // Same as above, all we need to check here is for a self-delegation due to the `votes()` invariant.
        bool isDelegateSelfDelegated = delegate == votes().delegatedAt(delegate, timepoint);
        if (!isDelegateSelfDelegated) {
            // Do not override votes of non-self-delegating accounts since those don't get their voting power from the
            // sum of delegations to them, so the override logic doesn't apply.
            return _weight;
        }

        // This is a delegator, so add a deduction to the delegated transcoder
        ProposalVoterState storage delegateVoter = _tally.voters[delegate];
        delegateVoter.deductions += _weight;

        if (delegateVoter.hasVoted) {
            // This is a delegator overriding its delegated transcoder vote,
            // we need to update the current totals to move the weight of
            // the delegator vote to the right outcome.
            VoteType delegateSupport = delegateVoter.support;

            if (delegateSupport == VoteType.Against) {
                _tally.againstVotes -= _weight;
            } else if (delegateSupport == VoteType.For) {
                _tally.forVotes -= _weight;
            } else {
                assert(delegateSupport == VoteType.Abstain);
                _tally.abstainVotes -= _weight;
            }
        }

        return _weight;
    }

    /**
     * @notice Provides the IVotes contract for all voting power handling logics.
     * @dev The returned contract must guarantee this invariant at any given timepoint: if an `_account` delegates to
     * itself (self-delegation), then its voting power must be greater than or equal to the sum of the voting power of
     * all its delegators. In pseudo-code: `votes(_account) >= sum(votes(delegators(_account)))`
     */
    function votes() public view virtual returns (IVotes);

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[48] private __gap;
}
