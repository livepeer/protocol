pragma solidity ^0.4.17;

import "../ManagerProxyTarget.sol";
import "./IBondingManager.sol";
import "./libraries/TranscoderPools.sol";
import "./libraries/TokenPools.sol";
import "../token/ILivepeerToken.sol";
import "../token/IMinter.sol";
import "../rounds/IRoundsManager.sol";
import "../jobs/IJobsManager.sol";

import "zeppelin-solidity/contracts/math/SafeMath.sol";


contract BondingManager is ManagerProxyTarget, IBondingManager {
    using SafeMath for uint256;
    using TranscoderPools for TranscoderPools.TranscoderPools;
    using TokenPools for TokenPools.Data;

    // Time between unbonding and possible withdrawl in rounds
    uint64 public unbondingPeriod;

    // Represents a transcoder's current state
    struct Transcoder {
        uint256 delegatorWithdrawRound;                      // The round at which delegators to this transcoder can withdraw if this transcoder resigns
        uint256 lastRewardRound;                             // Last round that the transcoder called reward
        uint8 blockRewardCut;                                // % of block reward cut paid to transcoder by a delegator
        uint8 feeShare;                                      // % of fees paid to delegators by transcoder
        uint256 pricePerSegment;                             // Price per segment (denominated in LPT units) for a stream
        uint8 pendingBlockRewardCut;                         // Pending block reward cut for next round if the transcoder is active
        uint8 pendingFeeShare;                               // Pending fee share for next round if the transcoder is active
        uint256 pendingPricePerSegment;                      // Pending price per segment for next round if the transcoder is active
        mapping (uint256 => TokenPools.Data) tokenPoolsPerRound;  // Mapping of round => token pools for the round
    }

    // The various states a transcoder can be in
    enum TranscoderStatus { NotRegistered, Registered, Resigned }

    // Represents a delegator's current state
    struct Delegator {
        uint256 bondedAmount;                    // The amount of bonded tokens
        uint256 unbondedAmount;                  // The amount of unbonded tokens
        address delegateAddress;                 // The address delegated to
        uint256 delegatedAmount;                 // The amount of tokens delegated to the delegator
        uint256 startRound;                      // The round the delegator transitions to bonded phase and is delegated to someone
        uint256 withdrawRound;                   // The round at which a delegator can withdraw
        uint256 lastClaimTokenPoolsSharesRound;  // The last round during which the delegator claimed its share of a transcoder's reward and fee pools
    }

    // The various states a delegator can be in
    enum DelegatorStatus { Pending, Bonded, Unbonding, Unbonded }

    // Keep track of the known transcoders and delegators
    mapping (address => Delegator) delegators;
    mapping (address => Transcoder) transcoders;

    // Candidate and reserve transcoder pools
    TranscoderPools.TranscoderPools transcoderPools;

    // Current active transcoders for current round
    Node.Node[] activeTranscoders;
    // Mapping to track which addresses are in the current active transcoder set
    mapping (address => bool) public isActiveTranscoder;
    // Mapping to track the index position of an address in the current active transcoder set
    mapping (address => uint256) public activeTranscoderPositions;
    // Total stake of all active transcoders
    uint256 public totalActiveTranscoderStake;

    // Only the RoundsManager can call
    modifier onlyRoundsManager() {
        require(IRoundsManager(msg.sender) == roundsManager());
        _;
    }

    // Only the JobsManager can call
    modifier onlyJobsManager() {
        require(IJobsManager(msg.sender) == jobsManager());
        _;
    }

    // Check if current round is initialized
    modifier currentRoundInitialized() {
        require(roundsManager().currentRoundInitialized());
        _;
    }

    // Automatically claim token pools shares from lastClaimTokenPoolsSharesRound through the current round
    modifier autoClaimTokenPoolsShares() {
        updateDelegatorWithTokenPoolsShares(msg.sender, roundsManager().currentRound());
        _;
    }

    function BondingManager(address _controller) Manager(_controller) {}

    function initialize(uint64 _unbondingPeriod, uint256 _numActiveTranscoders) external beforeInitialization returns (bool) {
        finishInitialization();
        // Set unbonding period
        unbondingPeriod = _unbondingPeriod;
        // Set up transcoder pools
        transcoderPools.init(_numActiveTranscoders, _numActiveTranscoders);
    }

    /*
     * @dev The sender is declaring themselves as a candidate for active transcoding.
     * @param _blockRewardCut % of block reward paid to transcoder by a delegator
     * @param _feeShare % of fees paid to delegators by a transcoder
     * @param _pricePerSegment Price per segment (denominated in LPT units) for a stream
     */
    function transcoder(uint8 _blockRewardCut, uint8 _feeShare, uint256 _pricePerSegment)
        external
        afterInitialization
        whenSystemNotPaused
        currentRoundInitialized
        returns (bool)
    {
        // Block reward cut must a valid percentage
        require(_blockRewardCut <= 100);
        // Fee share must be a valid percentage
        require(_feeShare <= 100);
        // Sender must not be a resigned transcoder
        require(transcoderStatus(msg.sender) != TranscoderStatus.Resigned);

        Transcoder storage t = transcoders[msg.sender];
        t.pendingBlockRewardCut = _blockRewardCut;
        t.pendingFeeShare = _feeShare;
        t.pendingPricePerSegment = _pricePerSegment;

        if (transcoderStatus(msg.sender) == TranscoderStatus.NotRegistered) {
            t.delegatorWithdrawRound = 0;

            transcoderPools.addTranscoder(msg.sender, delegators[msg.sender].delegatedAmount);
        }

        return true;
    }

    /*
     * @dev Remove the sender as a transcoder
     */
    function resignAsTranscoder()
        external
        afterInitialization
        whenSystemNotPaused
        currentRoundInitialized
        returns (bool)
    {
        // Sender must be registered transcoder
        require(transcoderStatus(msg.sender) == TranscoderStatus.Registered);
        // Remove transcoder from pools
        transcoderPools.removeTranscoder(msg.sender);
        // Set delegator withdraw round
        transcoders[msg.sender].delegatorWithdrawRound = roundsManager().currentRound().add(unbondingPeriod);

        return true;
    }

    /**
     * @dev Delegate stake towards a specific address.
     * @param _amount The amount of LPT to stake.
     * @param _to The address of the transcoder to stake towards.
     */
    function bond(
        uint256 _amount,
        address _to
    )
        external
        afterInitialization
        whenSystemNotPaused
        currentRoundInitialized
        autoClaimTokenPoolsShares
        returns (bool)
    {
        Delegator storage del = delegators[msg.sender];

        if (delegatorStatus(msg.sender) == DelegatorStatus.Unbonded) {
            // New delegate
            // Set start round
            del.startRound = roundsManager().currentRound().add(1);
        }

        // Amount to delegate
        uint256 delegationAmount = _amount;

        if (del.delegateAddress != address(0) && _to != del.delegateAddress) {
            // Changing delegate
            // Set start round
            del.startRound = roundsManager().currentRound().add(1);
            // Update amount to delegate with previous delegation amount
            delegationAmount = delegationAmount.add(del.bondedAmount);
            // Decrease old delegate's delegated amount
            delegators[del.delegateAddress].delegatedAmount = delegators[del.delegateAddress].delegatedAmount.sub(del.bondedAmount);

            if (transcoderStatus(del.delegateAddress) == TranscoderStatus.Registered) {
                // Previously delegated to a transcoder
                // Decrease old transcoder's total stake
                transcoderPools.decreaseTranscoderStake(del.delegateAddress, del.bondedAmount);
            }
        }

        del.delegateAddress = _to;
        del.bondedAmount = del.bondedAmount.add(_amount);

        // Update current delegate's delegated amount with delegation amount
        delegators[_to].delegatedAmount = delegators[_to].delegatedAmount.add(delegationAmount);

        if (transcoderStatus(_to) == TranscoderStatus.Registered) {
            // Delegated to a transcoder
            // Increase transcoder's total stake
            transcoderPools.increaseTranscoderStake(_to, delegationAmount);
        }

        if (_amount > 0) {
            if (_amount > del.unbondedAmount) {
                // If amount to bond is greater than the delegator's unbonded amount
                // use the delegator's unbonded amount and transfer the rest from the sender
                uint256 transferAmount = _amount.sub(del.unbondedAmount);
                // Set unbonded amount to 0
                del.unbondedAmount = 0;
                // Transfer the token to the Minter
                livepeerToken().transferFrom(msg.sender, minter(), transferAmount);
            } else {
                // If the amount to bond is less than or equal to the delegator's unbonded amount
                // just use the delegator's unbonded amount
                del.unbondedAmount = del.unbondedAmount.sub(_amount);
            }
        }

        return true;
    }

    /*
     * @dev Unbond delegator's current stake. Delegator enters unbonding state
     * @param _amount Amount of tokens to unbond
     */
    function unbond()
        external
        afterInitialization
        whenSystemNotPaused
        currentRoundInitialized
        autoClaimTokenPoolsShares
        returns (bool)
    {
        // Sender must be in bonded state
        require(delegatorStatus(msg.sender) == DelegatorStatus.Bonded);

        Delegator storage del = delegators[msg.sender];

        // Transition to unbonding phase
        del.withdrawRound = roundsManager().currentRound().add(unbondingPeriod);
        // Decrease delegate's delegated amount
        delegators[del.delegateAddress].delegatedAmount = delegators[del.delegateAddress].delegatedAmount.sub(del.bondedAmount);

        if (transcoderStatus(del.delegateAddress) == TranscoderStatus.Registered) {
            // Previously delegated to a transcoder
            // Decrease old transcoder's total stake
            transcoderPools.decreaseTranscoderStake(del.delegateAddress, del.bondedAmount);
        }

        // Delegator no longer bonded to anyone
        del.delegateAddress = address(0);

        return true;
    }

    /**
     * @dev Withdraws withdrawable funds back to the caller after unbonding period.
     */
    function withdraw()
        external
        afterInitialization
        whenSystemNotPaused
        currentRoundInitialized
        autoClaimTokenPoolsShares
        returns (bool)
    {
        // Delegator must either have unbonded tokens or be in the unbonded state
        require(delegators[msg.sender].unbondedAmount > 0 || delegatorStatus(msg.sender) == DelegatorStatus.Unbonded);

        uint256 amount = 0;

        if (delegators[msg.sender].unbondedAmount > 0) {
            // Withdraw unbonded amount
            amount = amount.add(delegators[msg.sender].unbondedAmount);
            delegators[msg.sender].unbondedAmount = 0;
        }

        if (delegatorStatus(msg.sender) == DelegatorStatus.Unbonded) {
            // Withdraw bonded amount which is now unbonded
            amount = amount.add(delegators[msg.sender].bondedAmount);
            delete delegators[msg.sender];
        }

        minter().transferTokens(msg.sender, amount);

        return true;
    }

    /*
     * @dev Set active transcoder set for the current round
     */
    function setActiveTranscoders() external afterInitialization whenSystemNotPaused onlyRoundsManager returns (bool) {
        if (activeTranscoders.length != transcoderPools.candidateTranscoders.nodes.length) {
            // Set length of array if it has not already been set
            activeTranscoders.length = transcoderPools.candidateTranscoders.nodes.length;
        }

        uint256 stake = 0;

        for (uint256 i = 0; i < transcoderPools.candidateTranscoders.nodes.length; i++) {
            if (activeTranscoders[i].initialized) {
                // Set address of old node to not be present in active transcoder set
                isActiveTranscoder[activeTranscoders[i].id] = false;
            }

            // Copy node
            activeTranscoders[i] = transcoderPools.candidateTranscoders.nodes[i];

            address activeTranscoder = activeTranscoders[i].id;

            // Set address of node to be present in active transcoder set
            isActiveTranscoder[activeTranscoder] = true;
            // Set index position of node in active transcoder set
            activeTranscoderPositions[activeTranscoder] = i;
            // Set pending rates as current rates
            transcoders[activeTranscoder].blockRewardCut = transcoders[activeTranscoder].pendingBlockRewardCut;
            transcoders[activeTranscoder].feeShare = transcoders[activeTranscoder].pendingFeeShare;
            transcoders[activeTranscoder].pricePerSegment = transcoders[activeTranscoder].pendingPricePerSegment;

            stake = stake.add(transcoderTotalStake(activeTranscoder));
        }

        // Update total stake of all active transcoders
        totalActiveTranscoderStake = stake;

        return true;
    }

    /*
     * @dev Distribute the token rewards to transcoder and delegates.
     * Active transcoders call this once per cycle when it is their turn.
     */
    function reward() external afterInitialization whenSystemNotPaused currentRoundInitialized returns (bool) {
        // Sender must be an active transcoder
        require(isActiveTranscoder[msg.sender]);

        uint256 currentRound = roundsManager().currentRound();

        // Transcoder must not have called reward for this round already
        require(transcoders[msg.sender].lastRewardRound != currentRound);
        // Set last round that transcoder called reward
        transcoders[msg.sender].lastRewardRound = currentRound;

        // Create reward based on active transcoder's stake relative to the total active stake
        // rewardTokens = (current mintable tokens for the round * active transcoder stake) / total active stake
        uint256 rewardTokens = minter().createReward(activeTranscoders[activeTranscoderPositions[msg.sender]].key, totalActiveTranscoderStake);

        updateTranscoderWithRewards(msg.sender, rewardTokens, currentRound);

        return true;
    }

    /*
     * @dev Update transcoder's fee pool
     * @param _transcoder Transcoder address
     * @param _fees Fees from verified job claims
     */
    function updateTranscoderWithFees(
        address _transcoder,
        uint256 _fees,
        uint256 _round
    )
        external
        afterInitialization
        whenSystemNotPaused
        onlyJobsManager
        returns (bool)
    {
        // Transcoder must be registered
        require(transcoderStatus(_transcoder) == TranscoderStatus.Registered);

        Transcoder storage t = transcoders[_transcoder];
        Delegator storage del = delegators[_transcoder];

        TokenPools.Data storage tokenPools = t.tokenPoolsPerRound[_round];
        // Add fees to fee pool
        tokenPools.feePool = tokenPools.feePool.add(_fees);
        // Compute claimable and unclaimable fees
        uint256 unclaimableFees = tokenPools.unclaimableFees(_fees);
        // Add unclaimable fees to the redistribution pool
        if (unclaimableFees > 0) {
            minter().addToRedistributionPool(unclaimableFees);
        }

        return true;
    }

    /*
     * @dev Slash a transcoder. Slashing can be invoked by the protocol or a finder.
     * @param _transcoder Transcoder address
     * @param _finder Finder that proved a transcoder violated a slashing condition. Null address if there is no finder
     * @param _slashAmount Percentage of transcoder bond to be slashed
     * @param _finderFee Percentage of penalty awarded to finder. Zero if there is no finder
     */
    function slashTranscoder(
        address _transcoder,
        address _finder,
        uint64 _slashAmount,
        uint64 _finderFee
    )
        external
        afterInitialization
        whenSystemNotPaused
        onlyJobsManager
        returns (bool)
    {
        // Transcoder must be valid
        require(transcoderStatus(_transcoder) == TranscoderStatus.Registered);

        uint256 penalty = delegators[_transcoder].bondedAmount.mul(_slashAmount).div(100);

        Delegator storage del = delegators[_transcoder];

        if (penalty > del.bondedAmount) {
            // Decrease transcoder's total stake by transcoder's stake
            transcoderPools.decreaseTranscoderStake(_transcoder, del.bondedAmount);
            // Set transcoder's bond to 0 since
            // the penalty is greater than its stake
            del.bondedAmount = 0;
        } else {
            // Decrease transcoder's total stake by the penalty
            transcoderPools.decreaseTranscoderStake(_transcoder, penalty);
            // Decrease transcoder's stake
            del.bondedAmount = del.bondedAmount.sub(penalty);
        }

        // Set withdraw round for delegators
        transcoders[msg.sender].delegatorWithdrawRound = roundsManager().currentRound().add(unbondingPeriod);

        // Remove transcoder from pools
        transcoderPools.removeTranscoder(_transcoder);

        // Add slashed amount to the redistribution pool
        if (penalty > 0) {
            uint256 redistributedAmount = penalty;

            if (_finder != address(0)) {
                // Award finder fee
                uint256 finderAmount = penalty.mul(_finderFee).div(100);
                redistributedAmount = redistributedAmount.sub(finderAmount);
                minter().transferTokens(_finder, finderAmount);
            }

            minter().addToRedistributionPool(redistributedAmount);
        }

        return true;
    }

    /*
     * @dev Pseudorandomly elect a currently active transcoder that charges a price per segment less than or equal to the max price per segment for a job
     * Returns address of elected active transcoder and its price per segment
     * @param _maxPricePerSegment Max price (in LPT base units) per segment of a stream
     */
    function electActiveTranscoder(uint256 _maxPricePerSegment) external returns (address) {
        // Create array to store available transcoders charging an acceptable price per segment
        Node.Node[] memory availableTranscoders = new Node.Node[](activeTranscoders.length);
        // Keep track of the actual number of available transcoders
        uint256 numAvailableTranscoders = 0;
        // Keep track of total stake of available transcoders
        uint256 totalAvailableTranscoderStake = 0;

        for (uint256 i = 0; i < activeTranscoders.length; i++) {
            // If a transcoders charges an acceptable price per segment add it to the array of available transcoders
            if (transcoders[activeTranscoders[i].id].pricePerSegment <= _maxPricePerSegment) {
                availableTranscoders[numAvailableTranscoders] = activeTranscoders[i];
                numAvailableTranscoders++;
                totalAvailableTranscoderStake = totalAvailableTranscoderStake.add(activeTranscoders[i].key);
            }
        }

        if (numAvailableTranscoders == 0) {
            // There is no currently available transcoder that charges a price per segment less than or equal to the max price per segment for a job
            return address(0);
        } else {
            address electedTranscoder = availableTranscoders[numAvailableTranscoders - 1].id;

            // Pseudorandomly pick an available transcoder weighted by its stake relative to the total stake of all available transcoders
            uint256 r = uint256(block.blockhash(block.number - 1)) % totalAvailableTranscoderStake;
            uint256 s = 0;

            for (uint256 j = 0; j < numAvailableTranscoders; j++) {
                s = s.add(availableTranscoders[j].key);

                if (s > r) {
                    electedTranscoder = availableTranscoders[j].id;
                    break;
                }
            }

            // Set total stake for fee pool for current round
            uint256 currentRound = roundsManager().currentRound();
            TokenPools.Data storage tokenPools = transcoders[electedTranscoder].tokenPoolsPerRound[currentRound];
            if (tokenPools.totalStake == 0) {
                tokenPools.init(activeTranscoderTotalStake(electedTranscoder), transcoders[electedTranscoder].blockRewardCut, transcoders[electedTranscoder].feeShare);
            }

            return electedTranscoder;
        }
    }

    /*
     * @dev Claim token pools shares for a delegator from its lastClaimTokenPoolsSharesRound through the end round
     * @param _endRound The last round for which to claim token pools shares for a delegator
     */
    function claimTokenPoolsShares(uint256 _endRound) external returns (bool) {
        require(delegators[msg.sender].lastClaimTokenPoolsSharesRound < _endRound);

        return updateDelegatorWithTokenPoolsShares(msg.sender, _endRound);
    }

    /*
     * @dev Returns bonded stake for a delegator. Includes reward pool shares since lastClaimTokenPoolsSharesRound
     * @param _delegator Address of delegator
     */
    function delegatorStake(address _delegator) public view returns (uint256) {
        Delegator storage del = delegators[_delegator];

        // Add rewards from the rounds during which the delegator was bonded to a transcoder
        if (delegatorStatus(_delegator) == DelegatorStatus.Bonded && transcoderStatus(del.delegateAddress) == TranscoderStatus.Registered) {
            uint256 currentRound = roundsManager().currentRound();
            uint256 currentBondedAmount = del.bondedAmount;

            for (uint256 i = del.lastClaimTokenPoolsSharesRound + 1; i <= currentRound; i++) {
                TokenPools.Data storage tokenPools = transcoders[del.delegateAddress].tokenPoolsPerRound[i];
                bool isTranscoder = _delegator == del.delegateAddress;
                // Calculate and add reward pool share from this round
                currentBondedAmount = currentBondedAmount.add(tokenPools.rewardPoolShare(currentBondedAmount, isTranscoder));
            }

            return currentBondedAmount;
        } else {
            return del.bondedAmount;
        }
    }

    /*
     * @dev Returns unbonded amount for a delegator. Includes fee pool shares since lastClaimTokenPoolsSharesRound
     * @param _delegator Address of delegator
     */
    function delegatorUnbondedAmount(address _delegator) public view returns (uint256) {
        Delegator storage del = delegators[_delegator];

        // Add fees from the rounds during which the delegator was bonded to a transcoder
        if (delegatorStatus(_delegator) == DelegatorStatus.Bonded && transcoderStatus(del.delegateAddress) == TranscoderStatus.Registered) {
            uint256 currentRound = roundsManager().currentRound();
            uint256 currentUnbondedAmount = del.unbondedAmount;
            uint256 currentBondedAmount = del.bondedAmount;

            for (uint256 i = del.lastClaimTokenPoolsSharesRound + 1; i <= currentRound; i++) {
                TokenPools.Data storage tokenPools = transcoders[del.delegateAddress].tokenPoolsPerRound[i];

                bool isTranscoder = _delegator == del.delegateAddress;
                // Calculate and add fee pool share from this round
                currentUnbondedAmount = currentUnbondedAmount.add(tokenPools.feePoolShare(currentBondedAmount, isTranscoder));
                // Calculate new bonded amount with rewards from this round. Updated bonded amount used
                // to calculate fee pool share in next round
                currentBondedAmount = currentBondedAmount.add(tokenPools.rewardPoolShare(currentBondedAmount, isTranscoder));
            }

            return currentUnbondedAmount;
        } else {
            return del.unbondedAmount;
        }
    }

    /*
     * @dev Returns total bonded stake for an active transcoder
     * @param _transcoder Address of a transcoder
     */
    function activeTranscoderTotalStake(address _transcoder) public view returns (uint256) {
        // Must be active transcoder
        require(isActiveTranscoder[_transcoder]);

        return activeTranscoders[activeTranscoderPositions[_transcoder]].key;
    }

    /*
     * @dev Returns total bonded stake for a transcoder
     * @param _transcoder Address of transcoder
     */
    function transcoderTotalStake(address _transcoder) public view returns (uint256) {
        return transcoderPools.transcoderStake(_transcoder);
    }

    /*
     * @dev Computes transcoder status
     * @param _transcoder Address of transcoder
     */
    function transcoderStatus(address _transcoder) public view returns (TranscoderStatus) {
        Transcoder storage t = transcoders[_transcoder];

        if (t.delegatorWithdrawRound > 0) {
            if (roundsManager().currentRound() >= t.delegatorWithdrawRound) {
                return TranscoderStatus.NotRegistered;
            } else {
                return TranscoderStatus.Resigned;
            }
        } else if (transcoderPools.isInPools(_transcoder)) {
            return TranscoderStatus.Registered;
        } else {
            return TranscoderStatus.NotRegistered;
        }
    }

    /*
     * @dev Computes delegator status
     * @param _delegator Address of delegator
     */
    function delegatorStatus(address _delegator) public view returns (DelegatorStatus) {
        Delegator storage del = delegators[_delegator];

        if (del.withdrawRound > 0) {
            // Delegator called unbond
            if (roundsManager().currentRound() >= del.withdrawRound) {
                return DelegatorStatus.Unbonded;
            } else {
                return DelegatorStatus.Unbonding;
            }
        } else if (transcoderStatus(del.delegateAddress) == TranscoderStatus.NotRegistered && transcoders[del.delegateAddress].delegatorWithdrawRound > 0) {
            // Transcoder resigned
            if (roundsManager().currentRound() >= transcoders[del.delegateAddress].delegatorWithdrawRound) {
                return DelegatorStatus.Unbonded;
            } else {
                return DelegatorStatus.Unbonding;
            }
        } else if (del.startRound > roundsManager().currentRound()) {
            // Delegator round start is in the future
            return DelegatorStatus.Pending;
        } else if (del.startRound > 0 && del.startRound <= roundsManager().currentRound()) {
            // Delegator round start is now or in the past
            return DelegatorStatus.Bonded;
        } else {
            // Default to unbonded
            return DelegatorStatus.Unbonded;
        }
    }

    // Transcoder getters

    function getTranscoderDelegatorWithdrawRound(address _transcoder) public view returns (uint256) {
        return transcoders[_transcoder].delegatorWithdrawRound;
    }

    function getTranscoderLastRewardRound(address _transcoder) public view returns (uint256) {
        return transcoders[_transcoder].lastRewardRound;
    }

    function getTranscoderBlockRewardCut(address _transcoder) public view returns (uint8) {
        return transcoders[_transcoder].blockRewardCut;
    }

    function getTranscoderFeeShare(address _transcoder) public view returns (uint8) {
        return transcoders[_transcoder].feeShare;
    }

    function getTranscoderPricePerSegment(address _transcoder) public view returns (uint256) {
        return transcoders[_transcoder].pricePerSegment;
    }

    function getTranscoderPendingBlockRewardCut(address _transcoder) public view returns (uint8) {
        return transcoders[_transcoder].pendingBlockRewardCut;
    }

    function getTranscoderPendingFeeShare(address _transcoder) public view returns (uint8) {
        return transcoders[_transcoder].pendingFeeShare;
    }

    function getTranscoderPendingPricePerSegment(address _transcoder) public view returns (uint256) {
        return transcoders[_transcoder].pendingPricePerSegment;
    }

    function getTranscoderRewardPoolForRound(address _transcoder, uint256 _round) public view returns (uint256) {
        return transcoders[_transcoder].tokenPoolsPerRound[_round].rewardPool;
    }

    function getTranscoderFeePoolForRound(address _transcoder, uint256 _round) public view returns (uint256) {
        return transcoders[_transcoder].tokenPoolsPerRound[_round].feePool;
    }

    function getTranscoderTotalStakeForRound(address _transcoder, uint256 _round) public view returns (uint256) {
        return transcoders[_transcoder].tokenPoolsPerRound[_round].totalStake;
    }

    function getTranscoderUsedStakeForRound(address _transcoder, uint256 _round) public view returns (uint256) {
        return transcoders[_transcoder].tokenPoolsPerRound[_round].usedStake;
    }

    // Delegator getters

    function getDelegatorBondedAmount(address _delegator) public view returns (uint256) {
        return delegators[_delegator].bondedAmount;
    }

    function getDelegatorUnbondedAmount(address _delegator) public view returns (uint256) {
        return delegators[_delegator].unbondedAmount;
    }

    function getDelegatorDelegateAddress(address _delegator) public view returns (address) {
        return delegators[_delegator].delegateAddress;
    }

    function getDelegatorDelegatedAmount(address _delegator) public view returns (uint256) {
        return delegators[_delegator].delegatedAmount;
    }

    function getDelegatorStartRound(address _delegator) public view returns (uint256) {
        return delegators[_delegator].startRound;
    }

    function getDelegatorWithdrawRound(address _delegator) public view returns (uint256) {
        return delegators[_delegator].withdrawRound;
    }

    function getDelegatorLastClaimTokenPoolsSharesRound(address _delegator) public view returns (uint256) {
        return delegators[_delegator].lastClaimTokenPoolsSharesRound;
    }

    /*
     * @dev Return current size of candidate transcoder pool
     */
    function getCandidatePoolSize() public view returns (uint256) {
        return transcoderPools.getCandidatePoolSize();
    }

    /*
     * @dev Return current size of reserve transcoder pool
     */
    function getReservePoolSize() public view returns (uint256) {
        return transcoderPools.getReservePoolSize();
    }

    /*
     * @dev Return candidate transcoder at position in candidate pool
     * @param _position Position in candidate pool
     */
    function getCandidateTranscoderAtPosition(uint256 _position) public view returns (address) {
        return transcoderPools.getCandidateTranscoderAtPosition(_position);
    }

    /*
     * @dev Return reserve transcoder at postion in reserve pool
     * @param _position Position in reserve pool
     */
    function getReserveTranscoderAtPosition(uint256 _position) public view returns (address) {
        return transcoderPools.getReserveTranscoderAtPosition(_position);
    }

    /*
     * @dev Update a transcoder with rewards
     * @param _transcoder Address of transcoder
     * @param _rewards Amount of rewards
     * @param _round Round that transcoder is updated
     */
    function updateTranscoderWithRewards(address _transcoder, uint256 _rewards, uint256 _round) internal returns (bool) {
        Transcoder storage t = transcoders[_transcoder];
        Delegator storage del = delegators[_transcoder];

        TokenPools.Data storage tokenPools = t.tokenPoolsPerRound[_round];
        // Lock in total stake, feeShare and blockRewardCut
        if (tokenPools.totalStake == 0) {
            tokenPools.init(activeTranscoderTotalStake(_transcoder), t.blockRewardCut, t.feeShare);
        }

        // Add rewards to reward pool
        tokenPools.rewardPool = tokenPools.rewardPool.add(_rewards);
        // Compute claimable and unclaimable rewards
        uint256 unclaimableRewards = tokenPools.unclaimableRewards(_rewards);
        uint256 claimableRewards = _rewards.sub(unclaimableRewards);
        // Update transcoder's delegated amount with claimable rewards
        del.delegatedAmount = del.delegatedAmount.add(claimableRewards);
        // Update transcoder's total stake with claimable rewards
        transcoderPools.increaseTranscoderStake(_transcoder, claimableRewards);
        // Add unclaimable rewards to the redistribution pool
        if (unclaimableRewards > 0) {
            minter().addToRedistributionPool(unclaimableRewards);
        }

        return true;
    }

    /*
     * @dev Update a delegator with token pools shares from its lastClaimTokenPoolsSharesRound through a given round
     * @param _delegator Delegator address
     * @param _endRound The last round for which to update a delegator's stake with token pools shares
     */
    function updateDelegatorWithTokenPoolsShares(address _delegator, uint256 _endRound) internal returns (bool) {
        Delegator storage del = delegators[_delegator];

        uint256 currentBondedAmount = del.bondedAmount;
        uint256 currentUnbondedAmount = del.unbondedAmount;

        for (uint256 i = del.lastClaimTokenPoolsSharesRound + 1; i <= _endRound; i++) {
            TokenPools.Data storage tokenPools = transcoders[del.delegateAddress].tokenPoolsPerRound[i];

            bool isTranscoder = _delegator == del.delegateAddress;
            uint256 fees = tokenPools.feePoolShare(currentBondedAmount, isTranscoder);
            uint256 rewards = tokenPools.rewardPoolShare(currentBondedAmount, isTranscoder);

            // Update used stake for token pools for the round
            tokenPools.usedStake = tokenPools.usedStake.add(currentBondedAmount);

            currentUnbondedAmount = currentUnbondedAmount.add(fees);
            currentBondedAmount = currentBondedAmount.add(rewards);
        }

        // Rewards are bonded by default
        del.bondedAmount = currentBondedAmount;
        // Fees are unbonded by default
        del.unbondedAmount = currentUnbondedAmount;

        del.lastClaimTokenPoolsSharesRound = _endRound;

        return true;
    }

    /*
     * @dev Return LivepeerToken
     */
    function livepeerToken() internal view returns (ILivepeerToken) {
        return ILivepeerToken(controller.getContract(keccak256("LivepeerToken")));
    }

    /*
     * @dev Return Minter
     */
    function minter() internal view returns (IMinter) {
        return IMinter(controller.getContract(keccak256("Minter")));
    }

    /*
     * @dev Return RoundsManager
     */
    function roundsManager() internal view returns (IRoundsManager) {
        return IRoundsManager(controller.getContract(keccak256("RoundsManager")));
    }

    /*
     * @dev Return JobsManager
     */
    function jobsManager() internal view returns (IJobsManager) {
        return IJobsManager(controller.getContract(keccak256("JobsManager")));
    }
}
