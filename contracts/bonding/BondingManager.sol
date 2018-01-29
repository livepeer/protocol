pragma solidity ^0.4.17;

import "../ManagerProxyTarget.sol";
import "./IBondingManager.sol";
import "../libraries/SortedDoublyLL.sol";
import "../libraries/MathUtils.sol";
import "./libraries/TokenPools.sol";
import "../token/ILivepeerToken.sol";
import "../token/IMinter.sol";
import "../rounds/IRoundsManager.sol";

import "zeppelin-solidity/contracts/math/Math.sol";
import "zeppelin-solidity/contracts/math/SafeMath.sol";


contract BondingManager is ManagerProxyTarget, IBondingManager {
    using SafeMath for uint256;
    using SortedDoublyLL for SortedDoublyLL.Data;
    using TokenPools for TokenPools.Data;

    // Time between unbonding and possible withdrawl in rounds
    uint64 public unbondingPeriod;
    // Number of active transcoders
    uint256 public numActiveTranscoders;

    // Represents a transcoder's current state
    struct Transcoder {
        uint256 lastRewardRound;                             // Last round that the transcoder called reward
        uint256 blockRewardCut;                              // % of block reward cut paid to transcoder by a delegator
        uint256 feeShare;                                    // % of fees paid to delegators by transcoder
        uint256 pricePerSegment;                             // Price per segment (denominated in LPT units) for a stream
        uint256 pendingBlockRewardCut;                       // Pending block reward cut for next round if the transcoder is active
        uint256 pendingFeeShare;                             // Pending fee share for next round if the transcoder is active
        uint256 pendingPricePerSegment;                      // Pending price per segment for next round if the transcoder is active
        mapping (uint256 => TokenPools.Data) tokenPoolsPerRound;  // Mapping of round => token pools for the round
    }

    // The various states a transcoder can be in
    enum TranscoderStatus { NotRegistered, Registered }

    // Represents a delegator's current state
    struct Delegator {
        uint256 bondedAmount;                    // The amount of bonded tokens
        uint256 fees;                            // The amount of fees collected
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

    // Keep track of total bonded tokens
    uint256 totalBonded;

    // Candidate and reserve transcoders
    SortedDoublyLL.Data transcoderPool;

    // Represents the active transcoder set
    struct ActiveTranscoderSet {
        address[] transcoders;
        mapping (address => bool) isActive;
        uint256 totalStake;
    }

    // Keep track of active transcoder set for each round
    mapping (uint256 => ActiveTranscoderSet) public activeTranscoderSet;

    // Check if sender is JobsManager
    modifier onlyJobsManager() {
        require(msg.sender == controller.getContract(keccak256("JobsManager")));
        _;
    }

    // Check if sender is RoundsManager
    modifier onlyRoundsManager() {
        require(msg.sender == controller.getContract(keccak256("RoundsManager")));
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

    function BondingManager(address _controller) public Manager(_controller) {}

    /*
     * @dev Batch set protocol parameters. Only callable by the controller owner
     * @param _unbondingPeriod Rounds between unbonding and possible withdrawl
     * @param _numTranscoders Max number of registered transcoders
     * @param _numActiveTranscoders Number of active transcoders
     */
    function setParameters(uint64 _unbondingPeriod, uint256 _numTranscoders, uint256 _numActiveTranscoders) external onlyControllerOwner {
        unbondingPeriod = _unbondingPeriod;

        // Max number of transcoders must be greater than or equal to number of active transcoders
        require(_numTranscoders >= _numActiveTranscoders);

        transcoderPool.setMaxSize(_numTranscoders);
        numActiveTranscoders = _numActiveTranscoders;

        ParameterUpdate("all");
    }

    /*
     * @dev Set unbonding period. Only callable by the controller owner
     * @param _unbondingPeriod Rounds between unbonding and possible withdrawal
     */
    function setUnbondingPeriod(uint64 _unbondingPeriod) external onlyControllerOwner {
        unbondingPeriod = _unbondingPeriod;

        ParameterUpdate("unbondingPeriod");
    }

    /*
     * @dev Set max number of registered transcoders. Only callable by the controller owner
     * @param _numTranscoders Max number of registered transcoders
     */
    function setNumTranscoders(uint256 _numTranscoders) external onlyControllerOwner {
        // Max number of transcoders must be greater than or equal to number of active transcoders
        require(_numTranscoders >= numActiveTranscoders);

        transcoderPool.setMaxSize(_numTranscoders);

        ParameterUpdate("numTranscoders");
    }

    /*
     * @dev Set number of active transcoders. Only callable by the controller owner
     * @param _numActiveTranscoders Number of active transcoders
     */
    function setNumActiveTranscoders(uint256 _numActiveTranscoders) external onlyControllerOwner {
        // Number of active transcoders cannot exceed max number of transcoders
        require(_numActiveTranscoders <= transcoderPool.getMaxSize());

        numActiveTranscoders = _numActiveTranscoders;

        ParameterUpdate("numActiveTranscoders");
    }

    /*
     * @dev The sender is declaring themselves as a candidate for active transcoding.
     * @param _blockRewardCut % of block reward paid to transcoder by a delegator
     * @param _feeShare % of fees paid to delegators by a transcoder
     * @param _pricePerSegment Price per segment (denominated in LPT units) for a stream
     */
    function transcoder(uint256 _blockRewardCut, uint256 _feeShare, uint256 _pricePerSegment)
        external
        whenSystemNotPaused
        currentRoundInitialized
    {
        // Only callable if current round is not locked
        require(!roundsManager().currentRoundLocked());
        // Block reward cut must be a valid percentage
        require(MathUtils.validPerc(_blockRewardCut));
        // Fee share must be a valid percentage
        require(MathUtils.validPerc(_feeShare));

        Delegator storage del = delegators[msg.sender];

        // Must have a non-zero amount bonded to self
        require(del.delegateAddress == msg.sender && del.bondedAmount > 0);

        Transcoder storage t = transcoders[msg.sender];
        t.pendingBlockRewardCut = _blockRewardCut;
        t.pendingFeeShare = _feeShare;
        t.pendingPricePerSegment = _pricePerSegment;

        uint256 delegatedAmount = del.delegatedAmount;

        // Check if transcoder is not already registered
        if (transcoderStatus(msg.sender) == TranscoderStatus.NotRegistered) {
            if (transcoderPool.isFull()) {
                address lastTranscoder = transcoderPool.getLast();

                if (delegatedAmount > transcoderPool.getKey(lastTranscoder)) {
                    // More stake than the last transcoder in the pool
                    // Kick out last transcoder pool
                    transcoderPool.remove(lastTranscoder);

                    TranscoderEvicted(lastTranscoder);
                }
            }

            transcoderPool.insert(msg.sender, delegatedAmount, address(0), address(0));
        }

        TranscoderUpdate(msg.sender, _blockRewardCut, _feeShare, _pricePerSegment);
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
        whenSystemNotPaused
        currentRoundInitialized
        autoClaimTokenPoolsShares
    {
        Delegator storage del = delegators[msg.sender];

        uint256 currentRound = roundsManager().currentRound();

        if (delegatorStatus(msg.sender) == DelegatorStatus.Unbonded) {
            // New delegate
            // Set start round
            del.startRound = currentRound.add(1);
        }

        // Amount to delegate
        uint256 delegationAmount = _amount;

        if (del.delegateAddress != address(0) && _to != del.delegateAddress) {
            // Changing delegate
            // Set start round
            del.startRound = currentRound.add(1);
            // Update amount to delegate with previous delegation amount
            delegationAmount = delegationAmount.add(del.bondedAmount);
            // Decrease old delegate's delegated amount
            delegators[del.delegateAddress].delegatedAmount = delegators[del.delegateAddress].delegatedAmount.sub(del.bondedAmount);

            if (transcoderStatus(del.delegateAddress) == TranscoderStatus.Registered) {
                // Previously delegated to a transcoder
                // Decrease old transcoder's total stake
                transcoderPool.updateKey(del.delegateAddress, transcoderPool.getKey(del.delegateAddress).sub(del.bondedAmount), address(0), address(0));
            }
        }

        del.delegateAddress = _to;
        del.bondedAmount = del.bondedAmount.add(_amount);

        // Update current delegate's delegated amount with delegation amount
        delegators[_to].delegatedAmount = delegators[_to].delegatedAmount.add(delegationAmount);

        // Update total bonded tokens
        totalBonded = totalBonded.add(_amount);

        if (transcoderStatus(_to) == TranscoderStatus.Registered) {
            // Delegated to a transcoder
            // Increase transcoder's total stake
            transcoderPool.updateKey(_to, transcoderPool.getKey(del.delegateAddress).add(delegationAmount), address(0), address(0));
        }

        if (_amount > 0) {
            // Transfer the LPT to the Minter
            livepeerToken().transferFrom(msg.sender, minter(), _amount);
        }

        Bond(_to, msg.sender);
    }

    /*
     * @dev Unbond delegator's current stake. Delegator enters unbonding state
     * @param _amount Amount of tokens to unbond
     */
    function unbond()
        external
        whenSystemNotPaused
        currentRoundInitialized
        autoClaimTokenPoolsShares
    {
        // Sender must be in bonded state
        require(delegatorStatus(msg.sender) == DelegatorStatus.Bonded);

        Delegator storage del = delegators[msg.sender];

        uint256 currentRound = roundsManager().currentRound();

        // Transition to unbonding phase
        del.withdrawRound = currentRound.add(unbondingPeriod);
        // Decrease delegate's delegated amount
        delegators[del.delegateAddress].delegatedAmount = delegators[del.delegateAddress].delegatedAmount.sub(del.bondedAmount);
        // Update total bonded tokens
        totalBonded = totalBonded.sub(del.bondedAmount);

        if (transcoderStatus(del.delegateAddress) == TranscoderStatus.Registered) {
            // Previously delegated to a transcoder
            // Decrease old transcoder's total stake
            transcoderPool.updateKey(del.delegateAddress, transcoderPool.getKey(del.delegateAddress).sub(del.bondedAmount), address(0), address(0));
        }

        // Delegator no longer bonded to anyone
        del.delegateAddress = address(0);
        // Unbonding delegator does not have a start round
        del.startRound = 0;

        // If caller is a registered transcoder, resign
        // In the future, with partial unbonding there would be a check for 0 bonded stake as well
        if (transcoderStatus(msg.sender) == TranscoderStatus.Registered) {
            resignTranscoder(msg.sender);
        }

        Unbond(del.delegateAddress, msg.sender);
    }

    /**
     * @dev Withdraws bonded stake to the caller after unbonding period.
     */
    function withdrawStake()
        external
        whenSystemNotPaused
        currentRoundInitialized
        autoClaimTokenPoolsShares
    {
        // Delegator must be in the unbonded state
        require(delegatorStatus(msg.sender) == DelegatorStatus.Unbonded);

        uint256 amount = delegators[msg.sender].bondedAmount;
        delegators[msg.sender].bondedAmount = 0;
        delegators[msg.sender].withdrawRound = 0;

        // Tell Minter to transfer stake (LPT) to the delegator
        minter().transferTokens(msg.sender, amount);

        WithdrawStake(msg.sender);
    }

    /**
     * @dev Withdraws fees to the caller
     */
    function withdrawFees()
        external
        whenSystemNotPaused
        currentRoundInitialized
        autoClaimTokenPoolsShares
    {
        // Delegator must have fees
        require(delegators[msg.sender].fees > 0);

        uint256 amount = delegators[msg.sender].fees;
        delegators[msg.sender].fees = 0;

        // Tell Minter to transfer fees (ETH) to the delegator
        minter().withdrawETH(msg.sender, amount);

        WithdrawFees(msg.sender);
    }

    /*
     * @dev Set active transcoder set for the current round
     */
    function setActiveTranscoders() external whenSystemNotPaused onlyRoundsManager {
        uint256 currentRound = roundsManager().currentRound();
        uint256 activeSetSize = Math.min256(numActiveTranscoders, transcoderPool.getSize());

        uint256 totalStake = 0;
        address currentTranscoder = transcoderPool.getFirst();

        for (uint256 i = 0; i < activeSetSize; i++) {
            activeTranscoderSet[currentRound].transcoders.push(currentTranscoder);
            activeTranscoderSet[currentRound].isActive[currentTranscoder] = true;

            uint256 stake = transcoderPool.getKey(currentTranscoder);
            uint256 blockRewardCut = transcoders[currentTranscoder].pendingBlockRewardCut;
            uint256 feeShare = transcoders[currentTranscoder].pendingFeeShare;
            uint256 pricePerSegment = transcoders[currentTranscoder].pendingPricePerSegment;

            Transcoder storage t = transcoders[currentTranscoder];
            // Set pending rates as current rates
            t.blockRewardCut = blockRewardCut;
            t.feeShare = feeShare;
            t.pricePerSegment = pricePerSegment;
            // Initialize token pool
            t.tokenPoolsPerRound[currentRound].init(stake, blockRewardCut, feeShare);

            totalStake = totalStake.add(stake);

            // Get next transcoder in the pool
            currentTranscoder = transcoderPool.getNext(currentTranscoder);
        }

        // Update total stake of all active transcoders
        activeTranscoderSet[currentRound].totalStake = totalStake;
    }

    /*
     * @dev Distribute the token rewards to transcoder and delegates.
     * Active transcoders call this once per cycle when it is their turn.
     */
    function reward() external whenSystemNotPaused currentRoundInitialized {
        uint256 currentRound = roundsManager().currentRound();

        // Sender must be an active transcoder
        require(activeTranscoderSet[currentRound].isActive[msg.sender]);

        // Transcoder must not have called reward for this round already
        require(transcoders[msg.sender].lastRewardRound != currentRound);
        // Set last round that transcoder called reward
        transcoders[msg.sender].lastRewardRound = currentRound;

        // Create reward based on active transcoder's stake relative to the total active stake
        // rewardTokens = (current mintable tokens for the round * active transcoder stake) / total active stake
        uint256 rewardTokens = minter().createReward(activeTranscoderTotalStake(msg.sender, currentRound), activeTranscoderSet[currentRound].totalStake);

        updateTranscoderWithRewards(msg.sender, rewardTokens, currentRound);

        Reward(msg.sender, rewardTokens);
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
        whenSystemNotPaused
        onlyJobsManager
    {
        // Transcoder must be registered
        require(transcoderStatus(_transcoder) == TranscoderStatus.Registered);

        Transcoder storage t = transcoders[_transcoder];

        TokenPools.Data storage tokenPools = t.tokenPoolsPerRound[_round];
        // Add fees to fee pool
        tokenPools.feePool = tokenPools.feePool.add(_fees);
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
        uint256 _slashAmount,
        uint256 _finderFee
    )
        external
        whenSystemNotPaused
        onlyJobsManager
    {
        uint256 penalty = MathUtils.percOf(delegators[_transcoder].bondedAmount, _slashAmount);
        if (penalty > del.bondedAmount) {
            penalty = del.bondedAmount;
        }

        Delegator storage del = delegators[_transcoder];

        // Decrease delegate's delegated amount
        delegators[del.delegateAddress].delegatedAmount = delegators[del.delegateAddress].delegatedAmount.sub(penalty);
        // Update total bonded tokens
        totalBonded = totalBonded.sub(penalty);
        // Decrease transcoder's stake
        del.bondedAmount = del.bondedAmount.sub(penalty);

        uint256 currentRound = roundsManager().currentRound();

        if (activeTranscoderSet[currentRound].isActive[_transcoder]) {
            // Decrease total active stake for the round
            activeTranscoderSet[currentRound].totalStake = activeTranscoderSet[currentRound].totalStake.sub(activeTranscoderTotalStake(_transcoder, currentRound));
            // Set transcoder as inactive
            activeTranscoderSet[currentRound].isActive[_transcoder] = false;
        }

        // Remove transcoder from pools
        transcoderPool.remove(_transcoder);

        // Account for penalty
        if (penalty > 0) {
            uint256 burnAmount = penalty;

            // Award finder fee if there is a finder address
            if (_finder != address(0)) {
                uint256 finderAmount = MathUtils.percOf(penalty, _finderFee);
                minter().transferTokens(_finder, finderAmount);

                // Subtract finder fee from the amount to be burned
                burnAmount = burnAmount.sub(finderAmount);
            }

            // Minter burns the remaining slashed funds
            minter().burnTokens(burnAmount);
        }

        TranscoderSlashed(_transcoder, penalty);
    }

    /*
     * @dev Pseudorandomly elect a currently active transcoder that charges a price per segment less than or equal to the max price per segment for a job
     * Returns address of elected active transcoder and its price per segment
     * @param _maxPricePerSegment Max price (in LPT base units) per segment of a stream
     * @param _blockHash Job creation block hash used as a pseudorandom seed for assigning an active transcoder
     * @param _round Job creation round
     */
    function electActiveTranscoder(uint256 _maxPricePerSegment, bytes32 _blockHash, uint256 _round) external view returns (address) {
        uint256 activeSetSize = activeTranscoderSet[_round].transcoders.length;
        // Create array to store available transcoders charging an acceptable price per segment
        address[] memory availableTranscoders = new address[](activeSetSize);
        // Keep track of the actual number of available transcoders
        uint256 numAvailableTranscoders = 0;
        // Keep track of total stake of available transcoders
        uint256 totalAvailableTranscoderStake = 0;

        for (uint256 i = 0; i < activeSetSize; i++) {
            address activeTranscoder = activeTranscoderSet[_round].transcoders[i];
            // If a transcoder is active and charges an acceptable price per segment add it to the array of available transcoders
            if (activeTranscoderSet[_round].isActive[activeTranscoder] && transcoders[activeTranscoder].pricePerSegment <= _maxPricePerSegment) {
                availableTranscoders[numAvailableTranscoders] = activeTranscoder;
                numAvailableTranscoders++;
                totalAvailableTranscoderStake = totalAvailableTranscoderStake.add(activeTranscoderTotalStake(activeTranscoder, _round));
            }
        }

        if (numAvailableTranscoders == 0) {
            // There is no currently available transcoder that charges a price per segment less than or equal to the max price per segment for a job
            return address(0);
        } else {
            address electedTranscoder = availableTranscoders[numAvailableTranscoders - 1];

            // Pseudorandomly pick an available transcoder weighted by its stake relative to the total stake of all available transcoders
            uint256 r = uint256(_blockHash) % totalAvailableTranscoderStake;
            uint256 s = 0;

            for (uint256 j = 0; j < numAvailableTranscoders; j++) {
                s = s.add(activeTranscoderTotalStake(availableTranscoders[j], _round));

                if (s > r) {
                    electedTranscoder = availableTranscoders[j];
                    break;
                }
            }

            return electedTranscoder;
        }
    }

    /*
     * @dev Claim token pools shares for a delegator from its lastClaimTokenPoolsSharesRound through the end round
     * @param _endRound The last round for which to claim token pools shares for a delegator
     */
    function claimTokenPoolsShares(uint256 _endRound) external {
        require(delegators[msg.sender].lastClaimTokenPoolsSharesRound < _endRound);

        updateDelegatorWithTokenPoolsShares(msg.sender, _endRound);
    }

    /*
     * @dev Returns pending bonded stake for a delegator. Includes reward pool shares since lastClaimTokenPoolsSharesRound
     * @param _delegator Address of delegator
     */
    function pendingStake(address _delegator) public view returns (uint256) {
        Delegator storage del = delegators[_delegator];

        // Add rewards from the rounds during which the delegator was bonded to a transcoder
        if (delegatorStatus(_delegator) == DelegatorStatus.Bonded && transcoderStatus(del.delegateAddress) == TranscoderStatus.Registered) {
            uint256 currentRound = roundsManager().currentRound();
            uint256 currentBondedAmount = del.bondedAmount;

            for (uint256 i = del.lastClaimTokenPoolsSharesRound + 1; i <= currentRound; i++) {
                TokenPools.Data storage tokenPools = transcoders[del.delegateAddress].tokenPoolsPerRound[i];

                bool isTranscoder = _delegator == del.delegateAddress;
                if (tokenPools.hasClaimableShares()) {
                    // Calculate and add reward pool share from this round
                    currentBondedAmount = currentBondedAmount.add(tokenPools.rewardPoolShare(currentBondedAmount, isTranscoder));
                }
            }

            return currentBondedAmount;
        } else {
            return del.bondedAmount;
        }
    }

    /*
     * @dev Returns pending fees for a delegator. Includes fee pool shares since lastClaimTokenPoolsSharesRound
     * @param _delegator Address of delegator
     */
    function pendingFees(address _delegator) public view returns (uint256) {
        Delegator storage del = delegators[_delegator];

        // Add fees from the rounds during which the delegator was bonded to a transcoder
        if (delegatorStatus(_delegator) == DelegatorStatus.Bonded && transcoderStatus(del.delegateAddress) == TranscoderStatus.Registered) {
            uint256 currentRound = roundsManager().currentRound();
            uint256 currentFees = del.fees;
            uint256 currentBondedAmount = del.bondedAmount;

            for (uint256 i = del.lastClaimTokenPoolsSharesRound + 1; i <= currentRound; i++) {
                TokenPools.Data storage tokenPools = transcoders[del.delegateAddress].tokenPoolsPerRound[i];

                if (tokenPools.hasClaimableShares()) {
                    bool isTranscoder = _delegator == del.delegateAddress;
                    // Calculate and add fee pool share from this round
                    currentFees = currentFees.add(tokenPools.feePoolShare(currentBondedAmount, isTranscoder));
                    // Calculate new bonded amount with rewards from this round. Updated bonded amount used
                    // to calculate fee pool share in next round
                    currentBondedAmount = currentBondedAmount.add(tokenPools.rewardPoolShare(currentBondedAmount, isTranscoder));
                }
            }

            return currentFees;
        } else {
            return del.fees;
        }
    }

    /*
     * @dev Returns total bonded stake for an active transcoder
     * @param _transcoder Address of a transcoder
     */
    function activeTranscoderTotalStake(address _transcoder, uint256 _round) public view returns (uint256) {
        // Must be active transcoder
        require(activeTranscoderSet[_round].isActive[_transcoder]);

        return transcoders[_transcoder].tokenPoolsPerRound[_round].totalStake;
    }

    /*
     * @dev Returns total bonded stake for a transcoder
     * @param _transcoder Address of transcoder
     */
    function transcoderTotalStake(address _transcoder) public view returns (uint256) {
        return transcoderPool.getKey(_transcoder);
    }

    /*
     * @dev Computes transcoder status
     * @param _transcoder Address of transcoder
     */
    function transcoderStatus(address _transcoder) public view returns (TranscoderStatus) {
        if (transcoderPool.contains(_transcoder)) {
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

    /*
     * @dev Return transcoder information
     * @param _transcoder Address of transcoder
     */
    function getTranscoder(
        address _transcoder
    )
        public
        view
        returns (uint256 lastRewardRound, uint256 blockRewardCut, uint256 feeShare, uint256 pricePerSegment, uint256 pendingBlockRewardCut, uint256 pendingFeeShare, uint256 pendingPricePerSegment)
    {
        Transcoder storage t = transcoders[_transcoder];

        lastRewardRound = t.lastRewardRound;
        blockRewardCut = t.blockRewardCut;
        feeShare = t.feeShare;
        pricePerSegment = t.pricePerSegment;
        pendingBlockRewardCut = t.pendingBlockRewardCut;
        pendingFeeShare = t.pendingFeeShare;
        pendingPricePerSegment = t.pendingPricePerSegment;
    }

    /*
     * @dev Return transcoder's token pools for a given round
     * @param _transcoder Address of transcoder
     * @param _round Round number
     */
    function getTranscoderTokenPoolsForRound(
        address _transcoder,
        uint256 _round
    )
        public
        view
        returns (uint256 rewardPool, uint256 feePool, uint256 totalStake, uint256 claimableStake)
    {
        TokenPools.Data storage tokenPools = transcoders[_transcoder].tokenPoolsPerRound[_round];

        rewardPool = tokenPools.rewardPool;
        feePool = tokenPools.feePool;
        totalStake = tokenPools.totalStake;
        claimableStake = tokenPools.claimableStake;
    }

    /*
     * @dev Return delegator info
     * @param _delegator Address of delegator
     */
    function getDelegator(
        address _delegator
    )
        public
        view
        returns (uint256 bondedAmount, uint256 fees, address delegateAddress, uint256 delegatedAmount, uint256 startRound, uint256 withdrawRound, uint256 lastClaimTokenPoolsSharesRound)
    {
        Delegator storage del = delegators[_delegator];

        bondedAmount = del.bondedAmount;
        fees = del.fees;
        delegateAddress = del.delegateAddress;
        delegatedAmount = del.delegatedAmount;
        startRound = del.startRound;
        withdrawRound = del.withdrawRound;
        lastClaimTokenPoolsSharesRound = del.lastClaimTokenPoolsSharesRound;
    }

    /*
     * @dev Returns size of transcoder pool
     */
    function getTranscoderPoolSize() public view returns (uint256) {
        return transcoderPool.getSize();
    }

    /*
     * @dev Returns transcoder with most stake in pool
     */
    function getFirstTranscoderInPool() public view returns (address) {
        return transcoderPool.getFirst();
    }

    /*
     * @dev Returns next transcoder in pool for a given transcoder
     * @param _transcoder Address of a transcoder in the pool
     */
    function getNextTranscoderInPool(address _transcoder) public view returns (address) {
        return transcoderPool.getNext(_transcoder);
    }

    /*
     * @dev Return total bonded tokens
     */
    function getTotalBonded() public view returns (uint256) {
        return totalBonded;
    }

    /*
     * @dev Return total active stake for a round
     * @param _round Round number
     */
    function getTotalActiveStake(uint256 _round) public view returns (uint256) {
        return activeTranscoderSet[_round].totalStake;
    }

    /*
     * @dev Return whether a transcoder was active during a round
     * @param _transcoder Transcoder address
     * @param _round Round number
     */
    function isActiveTranscoder(address _transcoder, uint256 _round) public view returns (bool) {
        return activeTranscoderSet[_round].isActive[_transcoder];
    }

    /*
     * @dev Remove transcoder
     */
    function resignTranscoder(address _transcoder) internal {
        uint256 currentRound = roundsManager().currentRound();
        if (activeTranscoderSet[currentRound].isActive[_transcoder]) {
            // If transcoder is active for the round set it as inactive
            activeTranscoderSet[currentRound].isActive[_transcoder] = false;
        }

        // Remove transcoder from pools
        transcoderPool.remove(_transcoder);

        TranscoderResigned(_transcoder);
    }

    /*
     * @dev Update a transcoder with rewards
     * @param _transcoder Address of transcoder
     * @param _rewards Amount of rewards
     * @param _round Round that transcoder is updated
     */
    function updateTranscoderWithRewards(address _transcoder, uint256 _rewards, uint256 _round) internal {
        Transcoder storage t = transcoders[_transcoder];
        Delegator storage del = delegators[_transcoder];

        TokenPools.Data storage tokenPools = t.tokenPoolsPerRound[_round];
        // Add rewards to reward pool
        tokenPools.rewardPool = tokenPools.rewardPool.add(_rewards);
        // Update transcoder's delegated amount with rewards
        del.delegatedAmount = del.delegatedAmount.add(_rewards);
        // Update transcoder's total stake with rewards
        uint256 newStake = transcoderPool.getKey(_transcoder).add(_rewards);
        transcoderPool.updateKey(_transcoder, newStake, address(0), address(0));
        // Update total bonded tokens with claimable rewards
        totalBonded = totalBonded.add(_rewards);
    }

    /*
     * @dev Update a delegator with token pools shares from its lastClaimTokenPoolsSharesRound through a given round
     * @param _delegator Delegator address
     * @param _endRound The last round for which to update a delegator's stake with token pools shares
     */
    function updateDelegatorWithTokenPoolsShares(address _delegator, uint256 _endRound) internal {
        Delegator storage del = delegators[_delegator];

        if (del.lastClaimTokenPoolsSharesRound > 0) {
            uint256 currentBondedAmount = del.bondedAmount;
            uint256 currentFees = del.fees;

            for (uint256 i = del.lastClaimTokenPoolsSharesRound + 1; i <= _endRound; i++) {
                TokenPools.Data storage tokenPools = transcoders[del.delegateAddress].tokenPoolsPerRound[i];

                if (tokenPools.hasClaimableShares()) {
                    bool isTranscoder = _delegator == del.delegateAddress;

                    var (fees, rewards) = tokenPools.claimShare(currentBondedAmount, isTranscoder);

                    currentFees = currentFees.add(fees);
                    currentBondedAmount = currentBondedAmount.add(rewards);
                }
            }

            // Rewards are bonded by default
            del.bondedAmount = currentBondedAmount;
            // Fees are unbonded by default
            del.fees = currentFees;
        }

        del.lastClaimTokenPoolsSharesRound = _endRound;
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
}
