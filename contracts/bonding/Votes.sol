// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/utils/Checkpoints.sol";

import "./BondingManager.sol";

abstract contract Votes is Governor {
    using Checkpoints for Checkpoints.Trace224;

    uint256 public constant MAX_ROUNDS_WITHOUT_CHECKPOINT = 100;

    // 33.33% perc points compatible with MathUtils
    uint256 public constant QUORUM = 333300;

    BondingManager public immutable bondingManagerAddr;

    constructor(BondingManager _bondingManager) {
        bondingManagerAddr = _bondingManager;
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
        return _getStake(_account, _timepoint);
    }

    function quorum(uint256 _timepoint) public view virtual override returns (uint256) {
        return MathUtils.percOf(getTotalActiveStake(_timepoint), QUORUM);
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
        (, , address delegatee) = getDelegatorSnapshot(account, timepoint);

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

    // checkpointing logic

    // We can't lookup the "checkpoint time" from the Checkpoints lib, only the
    // current value. So instead of checkpointing the bonded amount and
    // delegatee we snapshot the start round of each delegator change and lookup
    // the specific values on the separate delegatorSnapshots mapping.
    // TODO: Consider writing our own checkpoints lib version instead that
    // stores directly the data we want inline.
    mapping(address => Checkpoints.Trace224) private startRoundCheckpoints;

    struct DelegatorSnapshot {
        uint256 bondedAmount;
        address delegatee;
    }

    mapping(address => mapping(uint256 => DelegatorSnapshot)) private delegatorSnapshots;

    Checkpoints.Trace224 private totalActiveStakeCheckpoints;

    function checkpointDelegator(
        address _account,
        address _delegatee,
        uint224 _bondedAmount,
        uint32 _startRound
    ) internal virtual onlyBondingManager {
        delegatorSnapshots[_account][_startRound] = DelegatorSnapshot(_bondedAmount, _delegatee);

        startRoundCheckpoints[_account].push(_startRound, _startRound);
    }

    function checkpointTotalActiveStake(uint224 _totalStake, uint32 _round) internal virtual onlyBondingManager {
        totalActiveStakeCheckpoints.push(_round, _totalStake);
    }

    function _getStake(address _account, uint256 _timepoint) internal view returns (uint256) {
        require(_timepoint <= clock(), "getVotes: future lookup");

        // ASSUMPTIONS
        // - _timepoint is a round number
        // - _timepoint is the start round for the proposal's voting period

        (uint256 startRound, uint256 bondedAmount, address delegatee) = getDelegatorSnapshot(_account, _timepoint);
        bool isTranscoder = delegatee == _account;

        if (isTranscoder) {
            return getMostRecentTranscoderEarningPool(_account, _timepoint).totalStake;
        } else {
            // address is not a registered transcoder so we use its bonded
            // amount at the time of the proposal's voting period start plus
            // accrued rewards since that round.

            EarningsPool.Data memory startPool = getTranscoderEarningPool(delegatee, startRound);
            require(startPool.totalStake > 0, "missing start pool");

            uint256 endRound = _timepoint;
            EarningsPool.Data memory endPool = getMostRecentTranscoderEarningPool(delegatee, endRound);
            if (endPool.totalStake == 0) {
                // if we can't find an end pool where the transcoder called
                // `rewards()` return the originally bonded amount as the stake
                // at the end round (disconsider rewards since the start pool).
                return bondedAmount;
            }

            (uint256 stakeWithRewards, ) = bondingManager().delegatorCumulativeStakeAndFees(
                startPool,
                endPool,
                bondedAmount,
                0
            );
            return stakeWithRewards;
        }
    }

    function getDelegatorSnapshot(address _account, uint256 _timepoint)
        internal
        view
        returns (
            uint256 startRound,
            uint256 bondedAmount,
            address delegatee
        )
    {
        startRound = startRoundCheckpoints[_account].upperLookupRecent(SafeCast.toUint32(_timepoint));
        if (startRound == 0) {
            (bondedAmount, , delegatee, , startRound, , ) = bondingManager().getDelegator(_account);
            require(startRound <= _timepoint, "missing delegator snapshot for votes");

            return (startRound, bondedAmount, delegatee);
        }

        DelegatorSnapshot storage del = delegatorSnapshots[_account][startRound];

        bondedAmount = del.bondedAmount;
        delegatee = del.delegatee;
    }

    function getMostRecentTranscoderEarningPool(address _transcoder, uint256 _timepoint)
        internal
        view
        returns (EarningsPool.Data memory pool)
    {
        // lastActiveStakeUpdateRound is the last round that the transcoder's total active stake (self-delegated + delegated stake) was updated.
        // Any stake changes for a transcoder update the transcoder's total active stake for the *next* round.
        (, , , uint256 lastActiveStakeUpdateRound, , , , , , ) = bondingManager().getTranscoder(_transcoder);

        // If lastActiveStakeUpdateRound <= _timepoint, then the transcoder's total active stake at _timepoint should be the transcoder's
        // total active stake at lastActiveStakeUpdateRound because there were no additional stake changes after that round.
        if (lastActiveStakeUpdateRound <= _timepoint) {
            return getTranscoderEarningPool(_transcoder, lastActiveStakeUpdateRound);
        }

        // If lastActiveStakeUpdateRound > _timepoint, then the transcoder total active stake at _timepoint should be the transcoder's
        // total active stake at the most recent round before _timepoint that the transcoder's total active stake was checkpointed.
        // In order to prevent an unbounded loop, we limit the number of rounds that we'll search for a checkpointed total active stake to
        // MAX_ROUNDS_WITHOUT_CHECKPOINT.
        uint256 end = _timepoint - MAX_ROUNDS_WITHOUT_CHECKPOINT;
        for (uint256 i = _timepoint; i >= end; i--) {
            pool = getTranscoderEarningPool(_transcoder, i);
            if (pool.totalStake > 0) {
                return pool;
            }
        }
    }

    function getTranscoderEarningPool(address _transcoder, uint256 _timepoint)
        internal
        view
        returns (EarningsPool.Data memory pool)
    {
        (
            pool.totalStake,
            pool.transcoderRewardCut,
            pool.transcoderFeeShare,
            pool.cumulativeRewardFactor,
            pool.cumulativeFeeFactor
        ) = bondingManager().getTranscoderEarningsPoolForRound(_transcoder, _timepoint);
    }

    function getTotalActiveStake(uint256 _timepoint) internal view virtual returns (uint256) {
        require(_timepoint <= clock(), "getTotalSupply: future lookup");

        uint224 activeStake = totalActiveStakeCheckpoints.upperLookupRecent(SafeCast.toUint32(_timepoint));

        require(activeStake > 0, "getTotalSupply: no recorded active stake");

        return activeStake;
    }

    // Helpers for relations with other protocol contracts

    // Check if sender is BondingManager
    modifier onlyBondingManager() {
        _onlyBondingManager();
        _;
    }

    function bondingManager() public view returns (BondingManager) {
        return bondingManagerAddr;
    }

    function controller() public view returns (IController) {
        return bondingManager().controller();
    }

    function roundsManager() public view returns (IRoundsManager) {
        return IRoundsManager(controller().getContract(keccak256("RoundsManager")));
    }

    function _onlyBondingManager() internal view {
        require(msg.sender == address(bondingManagerAddr), "caller must be BondingManager");
    }
}
