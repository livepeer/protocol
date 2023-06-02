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

contract TreasuryGovernor is Governor, GovernorSettings {
    // 33.33% perc points compatible with MathUtils
    uint256 public constant QUORUM = 333300;

    IController public immutable controller;

    BondingCheckpoints public immutable bondingCheckpointsAddr;

    constructor(IController _controller, BondingCheckpoints _bondingCheckpoints)
        Governor("TreasuryGovernor")
        GovernorSettings(
            1, /* 1 round/day */
            14, /* 14 rounds/days */
            100e18 /* 100 LPT min proposal threshold */
        )
    {
        controller = _controller;
        bondingCheckpointsAddr = _bondingCheckpoints;
    }

    function proposalThreshold() public view override(Governor, GovernorSettings) returns (uint256) {
        return super.proposalThreshold();
    }

    /**
     * @dev Clock is set to match the current round.
     */
    function clock() public view virtual override returns (uint48) {
        return uint48(roundsManager().currentRound());
    }

    /**
     * @dev Machine-readable description of the clock as specified in EIP-6372.
     */
    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE() public view virtual override returns (string memory) {
        return "mode=livepeer_round&from=default";
    }

    // voting power

    function _getVotes(
        address _account,
        uint256 _timepoint,
        bytes memory
    ) internal view override returns (uint256) {
        require(_timepoint <= clock(), ")_getVotes: future lookup");

        return bondingCheckpoints().getStakeAt(_account, _timepoint);
    }

    function quorum(uint256 _timepoint) public view virtual override returns (uint256) {
        require(_timepoint <= clock(), ")_getVotes: future lookup");

        return MathUtils.percOf(bondingCheckpoints().getTotalActiveStakeAt(_timepoint), QUORUM);
    }

    // vote counting

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
        mapping(address => uint256) voteDeductions;
    }

    mapping(uint256 => ProposalVote) private _proposalVotes;

    /**
     * @dev See {IGovernor-COUNTING_MODE}.
     */
    // solhint-disable-next-line func-name-mixedcase
    function COUNTING_MODE() public pure virtual override returns (string memory) {
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
        ProposalVote storage proposalVote = _proposalVotes[proposalId];

        return quorum(proposalSnapshot(proposalId)) <= proposalVote.forVotes + proposalVote.abstainVotes;
    }

    /**
     * @dev See {Governor-_voteSucceeded}. In this module, the forVotes must be strictly over the againstVotes.
     */
    function _voteSucceeded(uint256 proposalId) internal view virtual override returns (bool) {
        ProposalVote storage proposalVote = _proposalVotes[proposalId];

        return proposalVote.forVotes > proposalVote.againstVotes;
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

        uint256 timepoint = proposalSnapshot(proposalId);
        (, , address delegatee) = bondingCheckpoints().getDelegatorSnapshot(account, timepoint);

        bool isTranscoder = account == delegatee;
        if (isTranscoder) {
            // deduce weight from any previous delegators for this transcoder to
            // make a vote
            weight = weight - proposalVote.voteDeductions[account];
        } else {
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
        }

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

    // Helpers for relations with other protocol contracts

    function bondingCheckpoints() public view returns (BondingCheckpoints) {
        return bondingCheckpointsAddr;
    }

    function roundsManager() public view returns (IRoundsManager) {
        return IRoundsManager(controller.getContract(keccak256("RoundsManager")));
    }
}
