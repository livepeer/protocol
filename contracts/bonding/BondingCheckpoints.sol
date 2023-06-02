// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/utils/Checkpoints.sol";

import "./libraries/EarningsPool.sol";
import "./libraries/EarningsPoolLIP36.sol";

import "../IController.sol";
import "../rounds/IRoundsManager.sol";
import "./BondingManager.sol";

contract BondingCheckpoints {
    using Checkpoints for Checkpoints.Trace224;

    uint256 public constant MAX_ROUNDS_WITHOUT_CHECKPOINT = 100;

    BondingManager public immutable bondingManagerAddr;

    constructor(BondingManager _bondingManager) {
        bondingManagerAddr = _bondingManager;
    }

    // We can't lookup the "checkpoint time" from the Checkpoints lib, only the
    // current value. So instead of checkpointing the bonded amount and
    // delegatee we snapshot the start round of each delegator change and lookup
    // the specific values on the separate delegatorSnapshots mapping.
    // TODO: Consider writing our own checkpoints lib version instead that
    // stores directly the data we want inline.

    struct DelegatorInfo {
        uint256 bondedAmount;
        address delegatee;
    }

    struct DelegatorCheckpoints {
        Checkpoints.Trace224 startRounds;
        mapping(uint256 => DelegatorInfo) snapshots;
    }

    mapping(address => DelegatorCheckpoints) private delegatorCheckpoints;

    Checkpoints.Trace224 private totalActiveStakeCheckpoints;

    function checkpointDelegator(
        address _account,
        uint256 _startRound,
        uint256 _bondedAmount,
        address _delegateAddress
    ) public virtual onlyBondingManager {
        DelegatorCheckpoints storage del = delegatorCheckpoints[_account];

        uint32 startRound = SafeCast.toUint32(_startRound);
        del.snapshots[startRound] = DelegatorInfo(_bondedAmount, _delegateAddress);

        // now store the startRound itself in the startRounds checkpoints to
        // allow us to lookup in the above mapping
        del.startRounds.push(startRound, startRound);
    }

    function checkpointTotalActiveStake(uint256 _totalStake, uint256 _round) public virtual onlyBondingManager {
        totalActiveStakeCheckpoints.push(SafeCast.toUint32(_round), SafeCast.toUint224(_totalStake));
    }

    function getTotalActiveStakeAt(uint256 _timepoint) public view virtual returns (uint256) {
        uint224 activeStake = totalActiveStakeCheckpoints.upperLookupRecent(SafeCast.toUint32(_timepoint));

        require(activeStake > 0, "getTotalSupply: no recorded active stake");

        return activeStake;
    }

    function getStakeAt(address _account, uint256 _timepoint) public view returns (uint256) {
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
        public
        view
        returns (
            uint256 startRound,
            uint256 bondedAmount,
            address delegatee
        )
    {
        DelegatorCheckpoints storage del = delegatorCheckpoints[_account];

        startRound = del.startRounds.upperLookupRecent(SafeCast.toUint32(_timepoint));
        if (startRound == 0) {
            (bondedAmount, , delegatee, , startRound, , ) = bondingManager().getDelegator(_account);
            require(startRound <= _timepoint, "missing delegator snapshot for votes");

            return (startRound, bondedAmount, delegatee);
        }

        DelegatorInfo storage snapshot = del.snapshots[startRound];

        bondedAmount = snapshot.bondedAmount;
        delegatee = snapshot.delegatee;
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

    // Helpers for relations with other protocol contracts

    // Check if sender is BondingManager
    modifier onlyBondingManager() {
        _onlyBondingManager();
        _;
    }

    function bondingManager() public view returns (BondingManager) {
        return bondingManagerAddr;
    }

    function _onlyBondingManager() internal view {
        require(msg.sender == address(bondingManagerAddr), "caller must be BondingManager");
    }
}
