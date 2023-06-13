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
        uint256[] claimRounds;
        mapping(uint256 => DelegatorInfo) snapshots;
    }

    mapping(address => DelegatorCheckpoints) private delegatorCheckpoints;

    mapping(uint256 => uint256) private totalActiveStakeCheckpoints;

    /**
     * @dev Clock is set to match the current round, which is the snapshotting
     *  method implemented here.
     */
    function clock() public view returns (uint48) {
        return SafeCast.toUint48(roundsManager().currentRound());
    }

    /**
     * @dev Machine-readable description of the clock as specified in EIP-6372.
     */
    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE() public view returns (string memory) {
        // TODO: Figure out the right value for this
        return "mode=livepeer_round&from=default";
    }

    function checkpointDelegator(
        address _account,
        uint256 _claimRound,
        uint256 _bondedAmount,
        address _delegateAddress
    ) public virtual onlyBondingManager {
        _checkpointDelegator(_account, _claimRound, _bondedAmount, _delegateAddress);
    }

    function initDelegatorCheckpoint(address _account) public virtual {
        (uint256 bondedAmount, , address delegatee, , , uint256 claimRound, ) = bondingManager().getDelegator(_account);

        _checkpointDelegator(_account, claimRound, bondedAmount, delegatee);
    }

    function checkpointTotalActiveStake(uint256 _totalStake, uint256 _round) public virtual onlyBondingManager {
        require(_round <= clock(), "can't checkpoint total active stake in the future");

        totalActiveStakeCheckpoints[_round] = _totalStake;
    }

    function getTotalActiveStakeAt(uint256 _timepoint) public view virtual returns (uint256) {
        require(_timepoint <= clock(), "getTotalActiveStakeAt: future lookup");

        uint256 activeStake = totalActiveStakeCheckpoints[_timepoint];

        require(activeStake > 0, "getTotalActiveStakeAt: no recorded active stake");

        return activeStake;
    }

    function getStakeAt(address _account, uint256 _timepoint) public view returns (uint256) {
        require(_timepoint <= clock(), "getStakeAt: future lookup");

        // ASSUMPTIONS
        // - _timepoint is a round number
        // - _timepoint is the start round for the proposal's voting period

        (uint256 claimRound, uint256 bondedAmount, address delegatee) = getDelegatorSnapshot(_account, _timepoint);
        bool isTranscoder = delegatee == _account;

        if (bondedAmount == 0) {
            return 0;
        } else if (isTranscoder) {
            return getMostRecentTranscoderEarningPool(_account, _timepoint, true).totalStake;
        } else {
            // address is not a registered transcoder so we use its bonded
            // amount at the time of the proposal's voting period start plus
            // accrued rewards since that round.

            EarningsPool.Data memory startPool = getTranscoderEarningPool(delegatee, claimRound);
            require(startPool.cumulativeRewardFactor > 0, "missing delegation start pool");

            uint256 endRound = _timepoint;
            EarningsPool.Data memory endPool = getMostRecentTranscoderEarningPool(delegatee, endRound, false);
            if (endPool.cumulativeRewardFactor == 0) {
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
            uint256 claimRound,
            uint256 bondedAmount,
            address delegatee
        )
    {
        DelegatorCheckpoints storage del = delegatorCheckpoints[_account];

        bool ok;
        (claimRound, ok) = lowerLookup(del.claimRounds, _timepoint);
        if (!ok) {
            (bondedAmount, , delegatee, , , claimRound, ) = bondingManager().getDelegator(_account);
            require(claimRound <= _timepoint, "missing delegator snapshot for votes");

            return (claimRound, bondedAmount, delegatee);
        }

        DelegatorInfo storage snapshot = del.snapshots[claimRound];

        bondedAmount = snapshot.bondedAmount;
        delegatee = snapshot.delegatee;
    }

    function _checkpointDelegator(
        address _account,
        uint256 _claimRound,
        uint256 _bondedAmount,
        address _delegateAddress
    ) internal {
        require(_claimRound <= clock(), "can't checkpoint delegator in the future");

        DelegatorCheckpoints storage del = delegatorCheckpoints[_account];

        del.snapshots[_claimRound] = DelegatorInfo(_bondedAmount, _delegateAddress);

        // now store the claimRound itself in the claimRounds array to allow us
        // to find it and lookup in the above mapping
        pushSorted(del.claimRounds, _claimRound);
    }

    function getMostRecentTranscoderEarningPool(
        address _transcoder,
        uint256 _timepoint,
        bool totalStakeOnly
    ) internal view returns (EarningsPool.Data memory pool) {
        // lastActiveStakeUpdateRound is the last round that the transcoder's total active stake (self-delegated + delegated stake) was updated.
        // Any stake changes for a transcoder update the transcoder's total active stake for the *next* round.
        (uint256 lastRewardRound, , , uint256 lastActiveStakeUpdateRound, , , , , , ) = bondingManager().getTranscoder(
            _transcoder
        );

        if (_timepoint == clock()) {
            pool = getTranscoderEarningPool(_transcoder, _timepoint);

            require(
                pool.totalStake > 0 && pool.cumulativeRewardFactor > 0,
                "transcoder must have already called reward when querying for the current round"
            );

            return pool;
        }

        // If lastActiveStakeUpdateRound <= _timepoint, then the transcoder's total active stake at _timepoint should be the transcoder's
        // total active stake at lastActiveStakeUpdateRound because there were no additional stake changes after that round.
        if (lastActiveStakeUpdateRound <= _timepoint) {
            _timepoint = lastActiveStakeUpdateRound;
        } else if (lastRewardRound <= _timepoint) {
            // Similarly, we can use lastRewardRound as the timepoint for the query if lastRewardRound <= _timepoint. Notice
            // that we can only do so when the above condition failed.
            _timepoint = lastRewardRound;
        }

        // If lastActiveStakeUpdateRound > _timepoint, then the transcoder total active stake at _timepoint should be the transcoder's
        // total active stake at the most recent round before _timepoint that the transcoder's total active stake was checkpointed.
        // In order to prevent an unbounded loop, we limit the number of rounds that we'll search for a checkpointed total active stake to
        // MAX_ROUNDS_WITHOUT_CHECKPOINT.
        uint256 end = 0;
        if (_timepoint > MAX_ROUNDS_WITHOUT_CHECKPOINT) {
            end = _timepoint - MAX_ROUNDS_WITHOUT_CHECKPOINT;
        }

        for (uint256 i = _timepoint; ; i--) {
            pool = getTranscoderEarningPool(_transcoder, i);

            bool hasTotalStake = pool.totalStake > 0;
            bool hasRewards = hasTotalStake && pool.cumulativeRewardFactor > 0;
            if ((totalStakeOnly && hasTotalStake) || hasRewards) {
                return pool;
            }

            if (i <= end) {
                break;
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

    function lowerLookup(uint256[] storage array, uint256 val) internal view returns (uint256, bool) {
        uint256 len = array.length;
        if (len == 0) {
            return (0, false);
        }

        uint256 lastElm = array[len - 1];
        if (lastElm <= val) {
            return (lastElm, true);
        }

        uint256 upperIdx = Arrays.findUpperBound(array, val);

        // we already checked the last element above so the upper must be inside the array
        require(upperIdx < len, "lowerLookup: invalid index returned by findUpperBoun");

        // the first snapshot we have is already higher than the value we wanted
        if (upperIdx == 0) {
            return (0, false);
        }

        uint256 upperElm = array[upperIdx];
        // the value we were searching is in the array
        if (upperElm == val) {
            return (val, true);
        }

        // the upperElm is the first element higher than the value we want, so return the previous element
        return (array[upperIdx - 1], true);
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

    /**
     * @dev Return IRoundsManager interface
     */
    function roundsManager() public view returns (IRoundsManager) {
        return IRoundsManager(controller.getContract(keccak256("RoundsManager")));
    }

    function _onlyBondingManager() internal view {
        require(msg.sender == address(bondingManager()), "caller must be BondingManager");
    }
}
