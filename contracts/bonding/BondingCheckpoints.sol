// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/Arrays.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

import "./libraries/EarningsPool.sol";
import "./libraries/EarningsPoolLIP36.sol";

import "../ManagerProxyTarget.sol";
import "../IController.sol";
import "../rounds/IRoundsManager.sol";
import "./BondingManager.sol";

contract BondingCheckpoints is ManagerProxyTarget, IBondingCheckpoints {
    uint256 public constant MAX_ROUNDS_WITHOUT_CHECKPOINT = 100;

    constructor(address _controller) Manager(_controller) {}

    struct DelegatorInfo {
        uint256 bondedAmount; // The amount of bonded tokens to another delegate as per the lastClaimRound
        address delegateAddress; // The address delegated to
        uint256 delegatedAmount; // The amount of tokens delegated to the account (only set for transcoders)
        uint256 lastClaimRound; // The last round during which the delegator claimed its earnings. Pegs the value of bondedAmount for rewards calculation
    }

    struct DelegatorCheckpoints {
        uint256[] startRounds;
        mapping(uint256 => DelegatorInfo) data;
    }

    mapping(address => DelegatorCheckpoints) private delegatorCheckpoints;

    uint256[] totalStakeCheckpointRounds;
    mapping(uint256 => uint256) private totalActiveStakeCheckpoints;

    // IERC5805 interface implementation

    /**
     * @dev Clock is set to match the current round, which is the checkpointing
     *  method implemented here.
     */
    function clock() public view returns (uint48) {
        return SafeCast.toUint48(roundsManager().currentRound());
    }

    /**
     * @dev Machine-readable description of the clock as specified in EIP-6372.
     */
    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE() public pure returns (string memory) {
        // TODO: Figure out the right value for this
        return "mode=livepeer_round&from=default";
    }

    /**
     * @dev Returns the current amount of votes that `account` has.
     */
    function getVotes(address account) external view returns (uint256) {
        return getDelegatorActiveStakeAt(account, clock());
    }

    /**
     * @dev Returns the amount of votes that `account` had at a specific moment in the past. If the `clock()` is
     * configured to use block numbers, this will return the value at the end of the corresponding block.
     */
    function getPastVotes(address account, uint256 timepoint) external view returns (uint256) {
        return getDelegatorActiveStakeAt(account, timepoint);
    }

    /**
     * @dev Returns the total supply of votes available at a specific round in the past.
     *
     * NOTE: This value is the sum of all active stake, which is not necessarily the sum of all delegated stake.
     * Bonded stake that is not part of the top 100 active set is still allowed to vote, but is not counted here.
     */
    function getPastTotalSupply(uint256 timepoint) external view returns (uint256) {
        return getTotalActiveStakeAt(timepoint);
    }

    /**
     * @dev Returns the delegate that `account` has chosen. This means the transcoder address both in case of delegators
     * and for the transcoder itself.
     */
    function delegates(address account) external view returns (address) {
        return delegatedAt(account, clock());
    }

    /**
     * @dev Returns the delegate that `account` had chosen in a specific round in the past. This is an addition to the
     * default IERC5805 interface for proper vote counting logic in the case of vote overrides.
     */
    function delegatedAt(address _account, uint256 _timepoint) public view returns (address) {
        DelegatorInfo storage del = getDelegatorInfoAt(_account, _timepoint);
        return del.delegateAddress;
    }

    /**
     * @dev Delegation through BondingCheckpoints is unsupported.
     */
    function delegate(address) external pure {
        revert("use BondingManager to update delegation through bonding");
    }

    /**
     * @dev Delegation through BondingCheckpoints is unsupported.
     */
    function delegateBySig(
        address,
        uint256,
        uint256,
        uint8,
        bytes32,
        bytes32
    ) external pure {
        revert("use BondingManager to update delegation through bonding");
    }

    // BondingManager checkpointing hooks
    function checkpointDelegator(
        address _account,
        uint256 _startRound,
        uint256 _bondedAmount,
        address _delegateAddress,
        uint256 _delegatedAmount,
        uint256 _lastClaimRound
    ) public virtual onlyBondingManager {
        require(_startRound <= clock() + 1, "can only checkpoint delegator up to the next round");
        require(_lastClaimRound < _startRound, "claim round must always be lower than start round");

        DelegatorCheckpoints storage checkpoints = delegatorCheckpoints[_account];

        checkpoints.data[_startRound] = DelegatorInfo(
            _bondedAmount,
            _delegateAddress,
            _delegatedAmount,
            _lastClaimRound
        );

        // now store the startRound itself in the startRounds array to allow us
        // to find it and lookup in the above mapping
        pushSorted(checkpoints.startRounds, _startRound);
    }

    function hasDelegatorCheckpoint(address _account) external virtual returns (bool) {
        return delegatorCheckpoints[_account].startRounds.length > 0;
    }

    function checkpointTotalActiveStake(uint256 _totalStake, uint256 _round) public virtual onlyBondingManager {
        require(_round <= clock() + 1, "can only checkpoint total active stake up to the next round");

        totalActiveStakeCheckpoints[_round] = _totalStake;

        pushSorted(totalStakeCheckpointRounds, _round);
    }

    // Internal logic

    function getTotalActiveStakeAt(uint256 _timepoint) internal view virtual returns (uint256) {
        require(_timepoint <= clock(), "getTotalActiveStakeAt: future lookup");

        // most of the time we will have the checkpoint from exactly the round we want
        uint256 activeStake = totalActiveStakeCheckpoints[_timepoint];
        if (activeStake > 0) {
            return activeStake;
        }

        (uint256 round, bool found) = lowerLookup(totalStakeCheckpointRounds, _timepoint);
        require(found, "getTotalActiveStakeAt: no recorded active stake");

        return totalActiveStakeCheckpoints[round];
    }

    function getDelegatorActiveStakeAt(address _account, uint256 _timepoint) internal view returns (uint256) {
        require(_timepoint <= clock(), "getStakeAt: future lookup");

        // ASSUMPTIONS
        // - _timepoint is a round number
        // - _timepoint is the start round for the proposal's voting period

        DelegatorInfo storage del = getDelegatorInfoAt(_account, _timepoint);
        bool isTranscoder = del.delegateAddress == _account;

        if (del.bondedAmount == 0) {
            return 0;
        } else if (isTranscoder) {
            // address is a registered transcoder so we use its delegated amount
            // (which self and delegated stake) at the time of the proposal
            return del.delegatedAmount;
        } else {
            // address is not a registered transcoder so we use its bonded
            // amount at the time of the proposal's voting period start plus
            // accrued rewards since that round.
            return delegatorCumulativeStakeAndFeesAt(del, _timepoint);
        }
    }

    function getDelegatorInfoAt(address _account, uint256 _timepoint) internal view returns (DelegatorInfo storage) {
        DelegatorCheckpoints storage checkpoints = delegatorCheckpoints[_account];

        (uint256 startRound, bool found) = lowerLookup(checkpoints.startRounds, _timepoint);
        require(found, "missing delegator checkpoint");

        return checkpoints.data[startRound];
    }

    function delegatorCumulativeStakeAndFeesAt(DelegatorInfo storage del, uint256 _timepoint)
        internal
        view
        returns (uint256)
    {
        // reward calculation uses the earning pool from the previous round.
        // this is because cumulative reward factors are calcualted for the
        // end of the round, valid only for the next round forward.
        uint256 rewardsStartRound = del.lastClaimRound;
        uint256 rewardsEndRound = _timepoint - 1;

        EarningsPool.Data memory startPool = getTranscoderEarningPool(del.delegateAddress, rewardsStartRound);
        require(startPool.cumulativeRewardFactor > 0, "missing delegation start pool");

        EarningsPool.Data memory endPool = getMostRecentTranscoderEarningPool(
            del.delegateAddress,
            rewardsEndRound,
            false
        );
        if (endPool.cumulativeRewardFactor == 0) {
            // if we can't find an end pool where the transcoder called
            // `rewards()` return the originally bonded amount as the stake
            // at the end round (disconsider rewards since the start pool).
            return del.bondedAmount;
        }

        (uint256 stakeWithRewards, ) = bondingManager().delegatorCumulativeStakeAndFees(
            startPool,
            endPool,
            del.bondedAmount,
            0
        );
        return stakeWithRewards;
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
        require(upperIdx < len, "lowerLookup: invalid index returned by findUpperBound");

        uint256 upperElm = array[upperIdx];
        // the value we were searching is in the array
        if (upperElm == val) {
            return (val, true);
        }

        // the first value in the array is already higher than the value we wanted
        if (upperIdx == 0) {
            return (0, false);
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
