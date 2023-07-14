// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/Arrays.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

import "./libraries/EarningsPool.sol";
import "./libraries/EarningsPoolLIP36.sol";
import "./libraries/SortedArrays.sol";

import "../ManagerProxyTarget.sol";
import "../IController.sol";
import "../rounds/IRoundsManager.sol";
import "./BondingManager.sol";

/**
 * @title BondingCheckpoints
 * @dev Checkpointing logic for BondingManager state for historical stake calculations.
 */
contract BondingCheckpoints is ManagerProxyTarget, IBondingCheckpoints {
    using SortedArrays for uint256[];

    constructor(address _controller) Manager(_controller) {}

    struct BondingCheckpoint {
        /**
         * @dev The amount of bonded tokens to another delegate as per the lastClaimRound.
         */
        uint256 bondedAmount;
        /**
         * @dev The address of the delegate the account is bonded to. In case of transcoders this is their own address.
         */
        address delegateAddress;
        /**
         * @dev The amount of tokens delegated from delegators to this account. This is only set for transcoders, which
         * have to self-delegate first and then have tokens bonded from other delegators.
         */
        uint256 delegatedAmount;
        /**
         * @dev The last round during which the delegator claimed its earnings. This pegs the value of bondedAmount for
         * rewards calculation in {EarningsPoolLIP36-delegatorCumulativeStakeAndFees}.
         */
        uint256 lastClaimRound;
        /**
         * @dev The last round during which the transcoder called {BondingManager-reward}. This is needed to find a
         * reward pool for any round when calculating historical rewards.
         *
         * Notice that this is the only field that comes from the Transcoder struct in BondingManager, not Delegator.
         */
        uint256 lastRewardRound;
    }

    /**
     * @dev Stores a list of checkpoints for an account, queryable and mapped by start round. To access the checkpoint
     * for a given round, find the checkpoint with the highest start round that is lower or equal to the queried round
     * ({SortedArrays-findLowerBound}) and then fetch the specific checkpoint on the data mapping.
     */
    struct BondingCheckpointsByRound {
        uint256[] startRounds;
        mapping(uint256 => BondingCheckpoint) data;
    }

    /**
     * @dev Checkpoints by account (delegators and transcoders).
     */
    mapping(address => BondingCheckpointsByRound) private bondingCheckpoints;

    /**
     * @dev Rounds in which we have checkpoints for the total active stake. This and {totalActiveStakeCheckpoints} are
     * handled in the same wat that {BondingCheckpointsByRound}, with rounds stored and queried on this array and
     * checkpointed value stored and retrieved from the mapping.
     */
    uint256[] totalStakeCheckpointRounds;
    /**
     * @dev See {totalStakeCheckpointRounds} above.
     */
    mapping(uint256 => uint256) private totalActiveStakeCheckpoints;

    // IERC6372 interface implementation

    /**
     * @notice Clock is set to match the current round, which is the checkpointing
     *  method implemented here.
     */
    function clock() public view returns (uint48) {
        return SafeCast.toUint48(roundsManager().currentRound());
    }

    /**
     * @notice Machine-readable description of the clock as specified in EIP-6372.
     */
    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE() public pure returns (string memory) {
        return "mode=livepeer_round";
    }

    // BondingManager checkpointing hooks

    /**
     * @notice Called by the BondingManager when the bonding state of an account changes.
     * @dev Since we checkpoint "delegator" and "transcoder" states, this is called both for the delegator and for the
     * transcoder when any change is made to the bonds, including when rewards are calculated or claimed.
     * @param _account The account whose bonding state changed
     * @param _startRound The round from which the bonding state will be active. This is normally the next round.
     * @param _bondedAmount From {BondingManager-Delegator-bondedAmount}
     * @param _delegateAddress From {BondingManager-Delegator-delegateAddress}
     * @param _delegatedAmount From {BondingManager-Transcoder-delegatedAmount}
     * @param _lastClaimRound From {BondingManager-Delegator-lastClaimRound}
     * @param _lastRewardRound From {BondingManager-Transcoder-lastRewardRound}
     */
    function checkpointBondingState(
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

        checkpoints.data[_startRound] = BondingCheckpoint({
            bondedAmount: _bondedAmount,
            delegateAddress: _delegateAddress,
            delegatedAmount: _delegatedAmount,
            lastClaimRound: _lastClaimRound,
            lastRewardRound: _lastRewardRound
        });

        // now store the startRound itself in the startRounds array to allow us
        // to find it and lookup in the above mapping
        checkpoints.startRounds.pushSorted(_startRound);
    }

    /**
     * @notice Returns whether an account already has any checkpoint.
     * @dev This is meant to be called by a checkpoint initialization script once we deploy the checkpointing logic for
     * the first time, so we can efficiently initialize the checkpoint state for all accounts in the system.
     */
    function hasCheckpoint(address _account) external view returns (bool) {
        return bondingCheckpoints[_account].startRounds.length > 0;
    }

    /**
     * @notice Called by the BondingManager when the total active stake changes.
     * @dev This is called only from the {BondingManager-setCurrentRoundTotalActiveStake} function to set the total
     * active stake in the current round.
     * @param _totalStake From {BondingManager-currentRoundTotalActiveStake}
     * @param _round The round for which the total active stake is valid. This is normally the current round.
     */
    function checkpointTotalActiveStake(uint256 _totalStake, uint256 _round) public virtual onlyBondingManager {
        require(_round <= clock(), "can only checkpoint total active stake in the current round");

        totalActiveStakeCheckpoints[_round] = _totalStake;

        totalStakeCheckpointRounds.pushSorted(_round);
    }

    // Historical stake access functions

    /**
     * @dev Gets the checkpointed total active stake at a given round.
     * @param _round The round for which we want to get the total active stake.
     */
    function getTotalActiveStakeAt(uint256 _round) public view virtual returns (uint256) {
        require(_round <= clock(), "getTotalActiveStakeAt: future lookup");

        uint256 activeStake = totalActiveStakeCheckpoints[_round];

        if (activeStake == 0) {
            uint256 lastInitialized = totalStakeCheckpointRounds.findLowerBound(_round);

            // Check that the round was in fact initialized so we don't return a 0 value accidentally.
            require(lastInitialized == _round, "getTotalActiveStakeAt: round was not initialized");
        }

        return activeStake;
    }

    /**
     * @notice Gets the bonding state of an account at a given round.
     * @dev In the case of delegators it is the amount they are delegating to a transcoder, while for transcoders this
     * includes all the stake that has been delegated to them (including self-delegated).
     * @param _account The account whose bonding state we want to get.
     * @param _round The round for which we want to get the bonding state. Normally a proposal's vote start round.
     * @return amount The active stake of the account at the given round including any accrued rewards. In case of
     * transcoders this also includes all the amount delegated towards them by other delegators.
     * @return delegateAddress The address the account delegated to. Will be equal to _account in case of transcoders.
     */
    function getBondingStateAt(address _account, uint256 _round)
        public
        view
        virtual
        returns (uint256 amount, address delegateAddress)
    {
        BondingCheckpoint storage bond = getBondingCheckpointAt(_account, _round);

        delegateAddress = bond.delegateAddress;
        bool isTranscoder = delegateAddress == _account;

        if (bond.bondedAmount == 0) {
            amount = 0;
        } else if (isTranscoder) {
            // Address is a registered transcoder so we use its delegated amount. This includes self and delegated stake
            // as well as any accrued rewards, even unclaimed ones
            amount = bond.delegatedAmount;
        } else {
            // Address is NOT a registered transcoder so we calculate its cumulative stake for the voting power
            amount = delegatorCumulativeStakeAt(bond, _round);
        }
    }

    /**
     * @dev Gets the checkpointed bonding state of an account at a round. This works by looking for the last checkpoint
     * at or before the given round and using the checkpoint of that round. If there hasn't been checkpoints since then
     * it means that the state hasn't changed.
     * @param _account The account whose bonding state we want to get.
     * @param _round The round for which we want to get the bonding state.
     * @return The {BondingCheckpoint} pointer to the checkpoints storage.
     */
    function getBondingCheckpointAt(address _account, uint256 _round)
        internal
        view
        returns (BondingCheckpoint storage)
    {
        require(_round <= clock(), "getBondingCheckpointAt: future lookup");

        BondingCheckpointsByRound storage checkpoints = bondingCheckpoints[_account];

        // Most of the time we will be calling this for a transcoder which checkpoints on every round through reward().
        // On those cases we will have a checkpoint for exactly the round we want, so optimize for that.
        BondingCheckpoint storage bond = checkpoints.data[_round];
        if (bond.bondedAmount > 0) {
            return bond;
        }

        uint256 startRound = checkpoints.startRounds.findLowerBound(_round);
        return checkpoints.data[startRound];
    }

    /**
     * @dev Gets the cumulative stake of a delegator at any given round. Differently from the bonding manager
     * implementation, we can calculate the stake at any round through the use of the checkpointed state. It works by
     * re-using the bonding manager logic while changing only the way that we find the earning pool for the end round.
     * @param bond The {BondingCheckpoint} of the delegator at the given round.
     * @param _round The round for which we want to get the cumulative stake.
     * @return The cumulative stake of the delegator at the given round.
     */
    function delegatorCumulativeStakeAt(BondingCheckpoint storage bond, uint256 _round)
        internal
        view
        returns (uint256)
    {
        EarningsPool.Data memory startPool = getTranscoderEarningPoolForRound(
            bond.delegateAddress,
            bond.lastClaimRound
        );
        require(startPool.cumulativeRewardFactor > 0, "missing earning pool from delegator's last claim round");

        (uint256 rewardRound, EarningsPool.Data memory endPool) = getTranscoderLastRewardsEarningPool(
            bond.delegateAddress,
            _round
        );

        // Only allow reward factor to be zero if transcoder had never called reward()
        require(
            endPool.cumulativeRewardFactor > 0 || rewardRound == 0,
            "missing transcoder earning pool on reported last reward round"
        );

        if (rewardRound < bond.lastClaimRound) {
            // If the transcoder hasn't called reward() since the last time the delegator claimed earnings, there wil be
            // no rewards to add to the delegator's stake so we just return the originally bonded amount.
            return bond.bondedAmount;
        }

        (uint256 stakeWithRewards, ) = EarningsPoolLIP36.delegatorCumulativeStakeAndFees(
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
     * provided _round and use its lastRewardRound value to grab the calculated earning pool. The only case where this
     * returns a zero earning pool is if the transcoder had never called reward() before _round.
     * @param _transcoder Address of the transcoder to look for
     * @param _round Past round at which we want the valid earning pool from
     * @return rewardRound Round in which the returned earning pool was calculated.
     * @return pool EarningsPool.Data struct with the last initialized earning pool.
     */
    function getTranscoderLastRewardsEarningPool(address _transcoder, uint256 _round)
        internal
        view
        returns (uint256 rewardRound, EarningsPool.Data memory pool)
    {
        BondingCheckpoint storage bond = getBondingCheckpointAt(_transcoder, _round);
        rewardRound = bond.lastRewardRound;
        pool = getTranscoderEarningPoolForRound(_transcoder, rewardRound);
    }

    /**
     * @dev Proxy for {BondingManager-getTranscoderEarningsPoolForRound} that returns an EarningsPool.Data struct.
     */
    function getTranscoderEarningPoolForRound(address _transcoder, uint256 _round)
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
        ) = bondingManager().getTranscoderEarningsPoolForRound(_transcoder, _round);
    }

    // Manager/Controller helpers

    /**
     * @dev Modified to ensure the sender is BondingManager
     */
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

    /**
     * @dev Ensure the sender is BondingManager
     */
    function _onlyBondingManager() internal view {
        require(msg.sender == address(bondingManager()), "caller must be BondingManager");
    }
}
