// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/utils/Arrays.sol";

import "./libraries/EarningsPool.sol";
import "./libraries/EarningsPoolLIP36.sol";

import "../ManagerProxyTarget.sol";
import "../IController.sol";
import "../rounds/IRoundsManager.sol";
import "./BondingManager.sol";

contract BondingCheckpoints is ManagerProxyTarget {
    uint256 public constant MAX_ROUNDS_WITHOUT_CHECKPOINT = 100;

    constructor(address _controller) Manager(_controller) {}

    struct DelegatorInfo {
        uint256 bondedAmount;
        address delegatee;
    }

    struct DelegatorCheckpoints {
        uint256[] startRounds;
        mapping(uint256 => DelegatorInfo) snapshots;
    }

    mapping(address => DelegatorCheckpoints) private delegatorCheckpoints;

    mapping(uint256 => uint256) private totalActiveStakeCheckpoints;

    function checkpointDelegator(
        address _account,
        uint256 _startRound,
        uint256 _bondedAmount,
        address _delegateAddress
    ) public virtual onlyBondingManager {
        DelegatorCheckpoints storage del = delegatorCheckpoints[_account];

        del.snapshots[_startRound] = DelegatorInfo(_bondedAmount, _delegateAddress);

        // now store the startRound itself in the startRounds array to allow us
        // to find it and lookup in the above mapping
        pushSorted(del.startRounds, _startRound);
    }

    function checkpointTotalActiveStake(uint256 _totalStake, uint256 _round) public virtual onlyBondingManager {
        totalActiveStakeCheckpoints[_round] = _totalStake;
    }

    function getTotalActiveStakeAt(uint256 _timepoint) public view virtual returns (uint256) {
        uint256 activeStake = totalActiveStakeCheckpoints[_timepoint];

        require(activeStake > 0, "getTotalActiveStakeAt: no recorded active stake");

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

        startRound = lowerLookup(del.startRounds, _timepoint);
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

    // array checkpointing logic
    // TODO: move to a library?

    function lowerLookup(uint256[] storage array, uint256 val) internal view returns (uint256) {
        uint256 upperIdx = Arrays.findUpperBound(array, val);
        if (upperIdx == 0) {
            return 0;
        }
        return array[upperIdx - 1];
    }

    function pushSorted(uint256[] storage array, uint256 val) internal {
        if (array.length == 0) {
            array.push(val);
        } else {
            uint256 last = array[array.length - 1];

            // values must be pushed in order
            require(val >= last, "pushSorted: decreasing values");

            // don't push duplicate values
            if (val != last) {
                array.push(val);
            }
        }
    }

    // Helpers for relations with other protocol contracts

    // Check if sender is BondingManager
    modifier onlyBondingManager() {
        _onlyBondingManager();
        _;
    }

    /**
     * @dev Return BondingManager interface
     */
    function bondingManager() internal view returns (BondingManager) {
        return BondingManager(controller.getContract(keccak256("BondingManager")));
    }

    function _onlyBondingManager() internal view {
        require(msg.sender == address(bondingManager()), "caller must be BondingManager");
    }
}
