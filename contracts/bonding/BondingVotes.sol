// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/Arrays.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

import "./libraries/EarningsPool.sol";
import "./libraries/EarningsPoolLIP36.sol";
import "./libraries/SortedArrays.sol";

import "../ManagerProxyTarget.sol";
import "./IBondingVotes.sol";
import "./IBondingManager.sol";
import "../rounds/IRoundsManager.sol";

/**
 * @title BondingVotes
 * @dev Checkpointing logic for BondingManager state for historical stake calculations.
 */
contract BondingVotes is ManagerProxyTarget, IBondingVotes {
    using Arrays for uint256[];
    using SortedArrays for uint256[];

    struct BondingCheckpoint {
        /**
         * @dev The amount of bonded tokens to another delegate as of the lastClaimRound.
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
         * @dev The last round during which the checkpointed account called {BondingManager-reward}. This is needed to
         * when calculating pending rewards for a delegator to this transcoder, to find the last earning pool available
         * for a given round. In that case we start from the delegator checkpoint and then fetch its delegate address
         * checkpoint as well to find the last earning pool.
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
     * @dev Stores a list of checkpoints for the total active stake, queryable and mapped by round. Notce that
     * differently from bonding checkpoints, it's only accessible on the specific round. To access the checkpoint for a
     * given round, look for the checkpoint in the {data}} and if it's zero ensure the round was actually checkpointed on
     * the {rounds} array ({SortedArrays-findLowerBound}).
     */
    struct TotalActiveStakeByRound {
        uint256[] rounds;
        mapping(uint256 => uint256) data;
    }

    /**
     * @dev Checkpoints by account (delegators and transcoders).
     */
    mapping(address => BondingCheckpointsByRound) private bondingCheckpoints;
    /**
     * @dev Total active stake checkpoints.
     */
    TotalActiveStakeByRound private totalStakeCheckpoints;

    /**
     * @dev Modifier to ensure the sender is BondingManager
     */
    modifier onlyBondingManager() {
        _onlyBondingManager();
        _;
    }

    /**
     * @dev Ensures that the provided round is in the past.
     */
    modifier onlyPastRounds(uint256 _round) {
        uint256 currentRound = clock();
        if (_round >= currentRound) {
            revert FutureLookup(_round, currentRound == 0 ? 0 : currentRound - 1);
        }
        _;
    }

    /**
     * @notice BondingVotes constructor. Only invokes constructor of base Manager contract with provided Controller address
     * @param _controller Address of Controller that this contract will be registered with
     */
    constructor(address _controller) Manager(_controller) {}

    // IVotes interface implementation.
    // These should not access any storage directly but proxy to the bonding state functions.

    /**
     * @notice Returns the name of the virtual token implemented by this.
     */
    function name() external pure returns (string memory) {
        return "Livepeer Voting Power";
    }

    /**
     * @notice Returns the symbol of the token underlying the voting power.
     */
    function symbol() external pure returns (string memory) {
        return "vLPT";
    }

    /**
     * @notice Returns the decimals places of the token underlying the voting.
     */
    function decimals() external pure returns (uint8) {
        return 18;
    }

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
    function CLOCK_MODE() external pure returns (string memory) {
        return "mode=livepeer_round";
    }

    /**
     * @notice Returns the current amount of votes that `_account` has.
     * @dev Keep in mind that since this function should return the votes at the end of the current round, we need to
     * fetch the bonding state at the next round instead. That because the bonding state reflects the active stake in
     * the current round, which is the snapshotted stake from the end of the previous round.
     */
    function getVotes(address _account) external view returns (uint256) {
        (uint256 amount, ) = getBondingStateAt(_account, clock() + 1);
        return amount;
    }

    /**
     * @notice Returns the amount of votes that `_account` had at a specific moment in the past. If the `clock()` is
     * configured to use block numbers, this will return the value at the end of the corresponding block.
     * @dev Keep in mind that since this function should return the votes at the end of the _round (or timepoint in OZ
     * terms), we need to fetch the bonding state at the next round instead. That because the bonding state reflects the
     * active stake in the current round, which is the snapshotted stake from the end of the previous round.
     */
    function getPastVotes(address _account, uint256 _round) external view onlyPastRounds(_round) returns (uint256) {
        (uint256 amount, ) = getBondingStateAt(_account, _round + 1);
        return amount;
    }

    /**
     * @notice Returns the current total supply of votes available.
     * @dev This value is the sum of all *active* stake, which is not necessarily the sum of all voting power.
     * Bonded stake that is not part of the top 100 active transcoder set is still given voting power, but is not
     * considered here.
     * @dev Keep in mind that since this function should return the votes at the end of the current round, we need to
     * fetch the total active stake at the next round instead. That because the active stake in the current round is the
     * snapshotted stake from the end of the previous round.
     */
    function totalSupply() external view returns (uint256) {
        return getTotalActiveStakeAt(clock() + 1);
    }

    /**
     * @notice Returns the total supply of votes available at a specific round in the past.
     * @dev This value is the sum of all *active* stake, which is not necessarily the sum of all voting power.
     * Bonded stake that is not part of the top 100 active transcoder set is still given voting power, but is not
     * considered here.
     * @dev Keep in mind that since this function should return the votes at the end of the _round (or timepoint in OZ
     * terms), we need to fetch the total active stake at the next round instead. That because the active stake in the
     * current round is the snapshotted stake from the end of the previous round.
     */
    function getPastTotalSupply(uint256 _round) external view onlyPastRounds(_round) returns (uint256) {
        return getTotalActiveStakeAt(_round + 1);
    }

    /**
     * @notice Returns the delegate that _account has chosen. This means the delegated transcoder address in case of
     * delegators, and the account's own address for transcoders (self-delegated).
     * @dev Keep in mind that since this function should return the delegate at the end of the current round, we need to
     * fetch the bonding state at the next round instead. That because the bonding state reflects the active stake in
     * the current round, or the snapshotted stake from the end of the previous round.
     */
    function delegates(address _account) external view returns (address) {
        (, address delegateAddress) = getBondingStateAt(_account, clock() + 1);
        return delegateAddress;
    }

    /**
     * @notice Returns the delegate that _account had chosen in a specific round in the past.
     * @dev This is an addition to the IERC5805 interface to support our custom vote counting logic that allows
     * delegators to override their transcoders votes. See {GovernorCountingOverridable-_handleVoteOverrides}.
     * @dev Keep in mind that since this function should return the delegate at the end of the _round (or timepoint in
     * OZ terms), we need to fetch the bonding state at the next round instead. That because the bonding state reflects
     * the active stake in the current round, which is the snapshotted stake from the end of the previous round.
     */
    function delegatedAt(address _account, uint256 _round) external view onlyPastRounds(_round) returns (address) {
        (, address delegateAddress) = getBondingStateAt(_account, _round + 1);
        return delegateAddress;
    }

    /**
     * @notice Delegation through BondingVotes is not supported.
     */
    function delegate(address) external pure {
        revert MustCallBondingManager("bond");
    }

    /**
     * @notice Delegation through BondingVotes is not supported.
     */
    function delegateBySig(
        address,
        uint256,
        uint256,
        uint8,
        bytes32,
        bytes32
    ) external pure {
        revert MustCallBondingManager("bondFor");
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
    ) external virtual onlyBondingManager {
        if (_startRound != clock() + 1) {
            revert InvalidStartRound(_startRound, clock() + 1);
        } else if (_lastClaimRound >= _startRound) {
            revert FutureLastClaimRound(_lastClaimRound, _startRound - 1);
        }

        BondingCheckpoint memory previous;
        if (hasCheckpoint(_account)) {
            previous = getBondingCheckpointAt(_account, _startRound);
        }

        BondingCheckpointsByRound storage checkpoints = bondingCheckpoints[_account];

        BondingCheckpoint memory bond = BondingCheckpoint({
            bondedAmount: _bondedAmount,
            delegateAddress: _delegateAddress,
            delegatedAmount: _delegatedAmount,
            lastClaimRound: _lastClaimRound,
            lastRewardRound: _lastRewardRound
        });
        checkpoints.data[_startRound] = bond;

        // now store the startRound itself in the startRounds array to allow us
        // to find it and lookup in the above mapping
        checkpoints.startRounds.pushSorted(_startRound);

        onBondingCheckpointChanged(_account, previous, bond);
    }

    /**
     * @notice Called by the BondingManager when the total active stake changes.
     * @dev This is called only from the {BondingManager-setCurrentRoundTotalActiveStake} function to set the total
     * active stake in the current round.
     * @param _totalStake From {BondingManager-currentRoundTotalActiveStake}
     * @param _round The round for which the total active stake is valid. This is normally the current round.
     */
    function checkpointTotalActiveStake(uint256 _totalStake, uint256 _round) external virtual onlyBondingManager {
        if (_round != clock()) {
            revert InvalidTotalStakeCheckpointRound(_round, clock());
        }

        totalStakeCheckpoints.data[_round] = _totalStake;
        totalStakeCheckpoints.rounds.pushSorted(_round);
    }

    /**
     * @notice Returns whether an account already has any checkpoint.
     */
    function hasCheckpoint(address _account) public view returns (bool) {
        return bondingCheckpoints[_account].startRounds.length > 0;
    }

    // Historical stake access functions

    /**
     * @dev Gets the checkpointed total active stake at a given round.
     * @param _round The round for which we want to get the total active stake.
     */
    function getTotalActiveStakeAt(uint256 _round) public view virtual returns (uint256) {
        if (_round > clock() + 1) {
            revert FutureLookup(_round, clock() + 1);
        }

        uint256 exactCheckpoint = totalStakeCheckpoints.data[_round];
        if (exactCheckpoint > 0) {
            return exactCheckpoint;
        }

        uint256[] storage initializedRounds = totalStakeCheckpoints.rounds;
        uint256 upper = initializedRounds.findUpperBound(_round);
        if (upper == 0) {
            // Return a zero voting power supply for any round before the first checkpoint. This also happens if there
            // are no checkpoints at all.
            return 0;
        } else if (upper < initializedRounds.length) {
            // Use the checkpoint from the next initialized round, which got the next total active stake checkpointed.
            uint256 nextInitedRound = initializedRounds[upper];
            return totalStakeCheckpoints.data[nextInitedRound];
        } else {
            // Here the _round is after any initialized round, so grab its stake from nextRoundTotalActiveStake()
            return bondingManager().nextRoundTotalActiveStake();
        }
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
     * @dev Reacts to changes in the bonding checkpoints of an account by emitting the corresponding events.
     */
    function onBondingCheckpointChanged(
        address _account,
        BondingCheckpoint memory previous,
        BondingCheckpoint memory current
    ) internal {
        address previousDelegate = previous.delegateAddress;
        address newDelegate = current.delegateAddress;
        if (previousDelegate != newDelegate) {
            emit DelegateChanged(_account, previousDelegate, newDelegate);
        }

        bool isTranscoder = newDelegate == _account;
        bool wasTranscoder = previousDelegate == _account;
        // we want to register zero "delegate votes" when the account is/was not a transcoder
        uint256 previousDelegateVotes = wasTranscoder ? previous.delegatedAmount : 0;
        uint256 currentDelegateVotes = isTranscoder ? current.delegatedAmount : 0;
        if (previousDelegateVotes != currentDelegateVotes) {
            emit DelegateVotesChanged(_account, previousDelegateVotes, currentDelegateVotes);
        }

        // Always send delegator events since transcoders are delegators themselves. The way our rewards work, the
        // delegator voting power calculated from events will only reflect their claimed stake without pending rewards.
        if (previous.bondedAmount != current.bondedAmount) {
            emit DelegatorBondedAmountChanged(_account, previous.bondedAmount, current.bondedAmount);
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
        if (_round > clock() + 1) {
            revert FutureLookup(_round, clock() + 1);
        }

        BondingCheckpointsByRound storage checkpoints = bondingCheckpoints[_account];

        // Most of the time we will be calling this for a transcoder which checkpoints on every round through reward().
        // On those cases we will have a checkpoint for exactly the round we want, so optimize for that.
        BondingCheckpoint storage bond = checkpoints.data[_round];
        if (bond.bondedAmount > 0) {
            return bond;
        }

        uint256 startRoundIdx = checkpoints.startRounds.findLowerBound(_round);
        if (startRoundIdx == checkpoints.startRounds.length) {
            // No checkpoint at or before _round, so return the zero BondingCheckpoint value. This also happens if there
            // are no checkpoints for _account. The voting power will be zero until the first checkpoint is made.
            return bond;
        }

        uint256 startRound = checkpoints.startRounds[startRoundIdx];
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
        EarningsPool.Data memory startPool = getTranscoderEarningsPoolForRound(
            bond.delegateAddress,
            bond.lastClaimRound
        );

        (uint256 rewardRound, EarningsPool.Data memory endPool) = getLastTranscoderRewardsEarningsPool(
            bond.delegateAddress,
            _round
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
    function getLastTranscoderRewardsEarningsPool(address _transcoder, uint256 _round)
        internal
        view
        returns (uint256 rewardRound, EarningsPool.Data memory pool)
    {
        BondingCheckpoint storage bond = getBondingCheckpointAt(_transcoder, _round);
        rewardRound = bond.lastRewardRound;

        if (rewardRound > 0) {
            pool = getTranscoderEarningsPoolForRound(_transcoder, rewardRound);

            if (pool.cumulativeRewardFactor == 0) {
                // Invalid state: a lastRewardRound is registered but there's no recorded earnings pool.
                revert MissingEarningsPool(_transcoder, rewardRound);
            }
        }
    }

    /**
     * @dev Proxy for {BondingManager-getTranscoderEarningsPoolForRound} that returns an EarningsPool.Data struct.
     */
    function getTranscoderEarningsPoolForRound(address _transcoder, uint256 _round)
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
     * @dev Return BondingManager interface
     */
    function bondingManager() internal view returns (IBondingManager) {
        return IBondingManager(controller.getContract(keccak256("BondingManager")));
    }

    /**
     * @dev Return IRoundsManager interface
     */
    function roundsManager() internal view returns (IRoundsManager) {
        return IRoundsManager(controller.getContract(keccak256("RoundsManager")));
    }

    /**
     * @dev Ensure the sender is BondingManager
     */
    function _onlyBondingManager() internal view {
        if (msg.sender != address(bondingManager())) {
            revert InvalidCaller(msg.sender, address(bondingManager()));
        }
    }
}
