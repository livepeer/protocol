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

    struct BondingCheckpoint {
        uint256 bondedAmount; // The amount of bonded tokens to another delegate as per the lastClaimRound
        address delegateAddress; // The address delegated to
        uint256 delegatedAmount; // The amount of tokens delegated to the account (only set for transcoders)
        uint256 lastClaimRound; // The last round during which the delegator claimed its earnings. Pegs the value of bondedAmount for rewards calculation
        uint256 lastRewardRound; // The last round during which the transcoder called rewards. This is useful to find the reward pool when calculating historical rewards. Notice that this actually comes from the Transcoder struct in bonding manager, not Delegator.
    }

    struct BondingCheckpointsByRound {
        uint256[] startRounds;
        mapping(uint256 => BondingCheckpoint) data;
    }

    mapping(address => BondingCheckpointsByRound) private bondingCheckpoints;

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
        BondingCheckpoint storage bond = getBondingCheckpointAt(_account, _timepoint);
        return bond.delegateAddress;
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
        uint256 _lastClaimRound,
        uint256 _lastRewardRound
    ) public virtual onlyBondingManager {
        require(_startRound <= clock() + 1, "can only checkpoint delegator up to the next round");
        require(_lastClaimRound < _startRound, "claim round must always be lower than start round");

        BondingCheckpointsByRound storage checkpoints = bondingCheckpoints[_account];

        checkpoints.data[_startRound] = BondingCheckpoint(
            _bondedAmount,
            _delegateAddress,
            _delegatedAmount,
            _lastClaimRound,
            _lastRewardRound
        );

        // now store the startRound itself in the startRounds array to allow us
        // to find it and lookup in the above mapping
        pushSorted(checkpoints.startRounds, _startRound);
    }

    function hasDelegatorCheckpoint(address _account) external virtual returns (bool) {
        return bondingCheckpoints[_account].startRounds.length > 0;
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

        uint256 round = ensureLowerLookup(totalStakeCheckpointRounds, _timepoint);
        return totalActiveStakeCheckpoints[round];
    }

    function getDelegatorActiveStakeAt(address _account, uint256 _timepoint) internal view returns (uint256) {
        require(_timepoint <= clock(), "getStakeAt: future lookup");

        // ASSUMPTIONS
        // - _timepoint is a round number
        // - _timepoint is the start round for the proposal's voting period

        BondingCheckpoint storage bond = getBondingCheckpointAt(_account, _timepoint);
        bool isTranscoder = bond.delegateAddress == _account;

        if (bond.bondedAmount == 0) {
            return 0;
        } else if (isTranscoder) {
            // address is a registered transcoder so we use its delegated amount
            // (which self and delegated stake) at the time of the proposal
            return bond.delegatedAmount;
        } else {
            // address is not a registered transcoder so we use its bonded
            // amount at the time of the proposal's voting period start plus
            // accrued rewards since that round.
            return delegatorCumulativeStakeAndFeesAt(bond, _timepoint);
        }
    }

    function getBondingCheckpointAt(address _account, uint256 _timepoint)
        internal
        view
        returns (BondingCheckpoint storage)
    {
        BondingCheckpointsByRound storage checkpoints = bondingCheckpoints[_account];
        uint256 startRound = ensureLowerLookup(checkpoints.startRounds, _timepoint);
        return checkpoints.data[startRound];
    }

    function delegatorCumulativeStakeAndFeesAt(BondingCheckpoint storage bond, uint256 _timepoint)
        internal
        view
        returns (uint256)
    {
        EarningsPool.Data memory startPool = getTranscoderEarningPoolForRound(
            bond.delegateAddress,
            bond.lastClaimRound
        );
        require(startPool.cumulativeRewardFactor > 0, "missing earning pool from delegator's last claim round");

        EarningsPool.Data memory endPool = getTranscoderLastRewardsEarningPool(bond.delegateAddress, _timepoint);
        if (endPool.cumulativeRewardFactor == 0) {
            // if we can't find an end pool where the transcoder called
            // `rewards()` return the originally bonded amount as the stake
            // at the end round (disconsider rewards since the start pool).
            return bond.bondedAmount;
        }

        (uint256 stakeWithRewards, ) = bondingManager().delegatorCumulativeStakeAndFees(
            startPool,
            endPool,
            bond.bondedAmount,
            0
        );
        return stakeWithRewards;
    }

    /**
     * @notice Returns the last initialized earning pool for a transcoder at a given round.
     * @dev Transcoders are just delegators with a self-delegation, so we find their last checkpoint before or at the
     * provided _timepoint and use its lastRewardRound value. That value is guaranteed to be the latest one with a valid
     * earning pool. The only case where this returns a zeroed pool is if the transcoder has never called reward().
     * @param _transcoder Address of the transcoder to look for
     * @param _timepoint Past round at which we want the valid earning pool from
     * @return pool EarningsPool.Data struct with the last initialized earning pool.
     */
    function getTranscoderLastRewardsEarningPool(address _transcoder, uint256 _timepoint)
        internal
        view
        returns (EarningsPool.Data memory pool)
    {
        // Most of the time we will already have the checkpoint from exactly the round we want
        BondingCheckpoint storage bond = bondingCheckpoints[_transcoder].data[_timepoint];

        if (bond.lastRewardRound == 0) {
            bond = getBondingCheckpointAt(_transcoder, _timepoint);
        }

        pool = getTranscoderEarningPoolForRound(_transcoder, bond.lastRewardRound);

        // only allow reward factor to be zero if transcoder has never called reward, which is handled automatically by
        // the bonding manager's delegatorCumulativeStakeAndFees reward calculation logic.
        require(
            bond.lastRewardRound == 0 || pool.cumulativeRewardFactor > 0,
            "missing transcoder earning pool on reported last reward round"
        );

        return pool;
    }

    function getTranscoderEarningPoolForRound(address _transcoder, uint256 _timepoint)
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

    function ensureLowerLookup(uint256[] storage array, uint256 val) internal view returns (uint256) {
        (uint256 lower, bool found) = lowerLookup(array, val);
        require(found, "ensureLowerLookup: no lower or equal value found in array");
        return lower;
    }

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
