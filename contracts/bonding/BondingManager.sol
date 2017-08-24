pragma solidity ^0.4.13;

import "./IBondingManager.sol";
import "./libraries/TranscoderPools.sol";
import "../Manager.sol";
import "../ContractRegistry.sol";
import "../LivepeerToken.sol";
import "../rounds/IRoundsManager.sol";
import "../jobs/IJobsManager.sol";

import "zeppelin-solidity/contracts/math/SafeMath.sol";

contract BondingManager is IBondingManager, Manager {
    using SafeMath for uint256;
    using TranscoderPools for TranscoderPools.TranscoderPools;

    // Token address
    LivepeerToken public token;

    // Start with 10M tokens. 1 LPT == 10^18th units
    uint256 public initialTokenSupply = 10000000 * (10 ** 18);

    // Upper bound inflation rate
    // Initially fixed at 26%
    uint8 public initialYearlyInflation = 26;

    // Time between unbonding and possible withdrawl in rounds
    uint64 public unbondingPeriod;

    // Represents a transcoder's current state
    struct Transcoder {
        address transcoderAddress;                           // The address of this transcoder
        uint256 bondedAmount;                                // The amount they have bonded themselves
        uint256 withdrawRound;                               // The round at which delegators to this transcoder can withdraw if this transcoder resigns
        uint256 lastRewardRound;                             // Last round that the transcoder called reward
        uint8 blockRewardCut;                                // % of block reward cut paid to transcoder by a delegator
        uint8 feeShare;                                      // % of fees paid to delegators by transcoder
        uint256 pricePerSegment;                             // Price per segment (denominated in LPT units) for a stream
        uint8 pendingBlockRewardCut;                         // Pending block reward cut for next round if the transcoder is active
        uint8 pendingFeeShare;                               // Pending fee share for next round if the transcoder is active
        uint256 pendingPricePerSegment;                      // Pending price per segment for next round if the transcoder is active
        mapping (uint256 => TokenPools) tokenPoolsPerRound;  // Mapping of round => token pools for the round
    }

    // The various states a transcoder can be in
    enum TranscoderStatus { NotRegistered, Registered, Unbonding, Unbonded }

    // Represents rewards and fees to be distributed to delegators
    struct TokenPools {
        RewardPool rewardPool;
        ClaimFees[] feePool;
    }

    // Represents rewards to be distributed to delegators
    struct RewardPool {
        uint256 rewards;
        uint256 transcoderTotalStake;
    }

    // Represents fees to be distributed to delegators
    struct ClaimFees {
        uint256 claimBlock;
        uint256 fees;
        uint256 transcoderTotalStake;
    }

    // Represents a delegator's current state
    struct Delegator {
        address delegatorAddress;          // The ethereum address of this delegator
        uint256 bondedAmount;              // The amount they have bonded
        address transcoderAddress;         // The ethereum address of the transcoder they are delgating towards
        uint256 startRound;                // The round the delegator transitions to bonded phase
        uint256 delegateBlock;             // The block the delegator bonds to a transcoder
        uint256 withdrawRound;             // The round at which a delegator can withdraw
        uint256 lastStakeUpdateRound;      // The last round the delegator transitioned states
    }

    // The various states a delegator can be in
    enum DelegatorStatus { NotRegistered, Pending, Bonded, Unbonding, Unbonded }

    // Keep track of the known transcoders and delegators
    // Note: Casper style implementation would have us using arrays and bitmaps to index these
    mapping (address => Delegator) public delegators;
    mapping (address => Transcoder) public transcoders;

    // Active and candidate transcoder pools
    TranscoderPools.TranscoderPools transcoderPools;

    // Current active transcoders for current round
    Node.Node[] activeTranscoders;
    // Mapping to track which addresses are in the current active transcoder set
    mapping (address => bool) public isActiveTranscoder;
    // Mapping to track the index position of an address in the current active transcoder set
    mapping (address => uint256) public activeTranscoderPositions;

    // Only the RoundsManager can call
    modifier onlyRoundsManager() {
        require(msg.sender == address(roundsManager()));
        _;
    }

    // Only the JobsManager can call
    modifier onlyJobsManager() {
        require(msg.sender == address(jobsManager()));
        _;
    }

    /*
     * @dev BondingManager constructor. Sets a pre-existing address for the LivepeerToken contract
     * @param _token LivepeerToken contract address
     */
    function BondingManager(
        address _registry,
        address _token,
        uint256 _numActiveTranscoders,
        uint64 _unbondingPeriod
    ) Manager(_registry) {
        // Set LivepeerToken address
        token = LivepeerToken(_token);

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
        whenSystemNotPaused
        returns (bool)
    {
        // Current round must be initialized
        require(roundsManager().currentRoundInitialized());
        // Block reward cut must a valid percentage
        require(_blockRewardCut <= 100);
        // Fee share must be a valid percentage
        require(_feeShare <= 100);

        Transcoder storage t = transcoders[msg.sender];
        t.transcoderAddress = msg.sender;
        t.pendingBlockRewardCut = _blockRewardCut;
        t.pendingFeeShare = _feeShare;
        t.pendingPricePerSegment = _pricePerSegment;

        return true;
    }

    /*
     * @dev Remove the sender as a transcoder
     */
    function resignAsTranscoder() external whenSystemNotPaused returns (bool) {
        // Current round must be initialized
        require(roundsManager().currentRoundInitialized());
        // Sender must be registered transcoder
        require(transcoderStatus(msg.sender) == TranscoderStatus.Registered);

        // Set withdraw round
        transcoders[msg.sender].withdrawRound = roundsManager().currentRound().add(unbondingPeriod);

        if (transcoderPools.isInPools(msg.sender)) {
            // Remove transcoder from pools
            transcoderPools.removeTranscoder(msg.sender);
        }

        return true;
    }

    /**
     * @dev Delegate stake towards a specific address.
     * @param _amount The amount of LPT to stake.
     * @param _to The address of the transcoder to stake towards.
     */
    function bond(uint256 _amount, address _to) external whenSystemNotPaused returns (bool) {
        // Current round must be initialized
        require(roundsManager().currentRoundInitialized());
        // Must bond to a valid transcoder
        require(transcoderStatus(_to) == TranscoderStatus.Registered);

        uint256 stakeForTranscoder = _amount;

        if (_to == msg.sender) {
            // Sender is a transcoder bonding to self
            transcoders[msg.sender].bondedAmount = transcoders[msg.sender].bondedAmount.add(_amount);
        } else {
            // Sender is not a transcoder
            // Update/create delegator
            Delegator storage del = delegators[msg.sender];

            // Update delegator stake if necessary
            updateDelegatorStake(msg.sender);

            if (delegatorStatus(msg.sender) == DelegatorStatus.NotRegistered
                || delegatorStatus(msg.sender) == DelegatorStatus.Unbonded)
            {
                // Registering as delegator or bonding to transcoder from the unbonded state
                // Set start round and delegate block
                del.startRound = roundsManager().currentRound().add(1);
                del.delegateBlock = block.number;
            }

            if (del.transcoderAddress != address(0) && _to != del.transcoderAddress) {
                // Delegator is moving bond
                // Set round start if delegator moves bond to another active transcoder
                del.startRound = roundsManager().currentRound().add(1);
                // Decrease former transcoder cumulative stake
                transcoderPools.decreaseTranscoderStake(del.transcoderAddress, del.bondedAmount);
                // Stake amount includes delegator's total bonded amount since delegator is moving its bond
                stakeForTranscoder = stakeForTranscoder.add(del.bondedAmount);
            }

            del.delegatorAddress = msg.sender;
            del.transcoderAddress = _to;
            del.bondedAmount = del.bondedAmount.add(_amount);
        }

        if (transcoderPools.isInPools(_to)) {
            // Target transcoder is in a pool
            // Increase transcoder cumulative stake
            transcoderPools.increaseTranscoderStake(_to, stakeForTranscoder);
        } else {
            // Target transcoder is not in a pool
            // Add transcoder
            transcoderPools.addTranscoder(_to, stakeForTranscoder);
        }

        if (_amount > 0) {
            // Only transfer tokens if _amount is greater than 0
            // Transfer the token. This call throws if it fails.
            token.transferFrom(msg.sender, this, _amount);
        }

        return true;
    }

    /*
     * @dev Unbond delegator's current stake. Delegator enters unbonding state
     */
    function unbond() external whenSystemNotPaused returns (bool) {
        // Current round must be initialized
        require(roundsManager().currentRoundInitialized());

        Delegator storage del = delegators[msg.sender];

        // Sender must be in bonded state
        require(delegatorStatus(msg.sender) == DelegatorStatus.Bonded);

        // Update delegator stake
        updateDelegatorStake(msg.sender);

        // Transition to unbonding phase
        del.withdrawRound = roundsManager().currentRound().add(unbondingPeriod);

        // Decrease transcoder total stake
        transcoderPools.decreaseTranscoderStake(del.transcoderAddress, del.bondedAmount);

        // Delegator no longer bonded to anyone
        del.transcoderAddress = address(0);

        return true;
    }

    /**
     * @dev Withdraws withdrawable funds back to the caller after unbonding period.
     */
    function withdraw() external whenSystemNotPaused returns (bool) {
        // Current round must be initialized
        require(roundsManager().currentRoundInitialized());

        if (transcoderStatus(msg.sender) == TranscoderStatus.Unbonding) {
            token.transfer(msg.sender, transcoders[msg.sender].bondedAmount);

            delete transcoders[msg.sender];
        } else if (delegatorStatus(msg.sender) == DelegatorStatus.Unbonding){
            token.transfer(msg.sender, delegators[msg.sender].bondedAmount);

            delete delegators[msg.sender];
        } else {
            // Sender is neither a transcoder or delegator
            revert();
        }

        return true;
    }

    /*
     * @dev Set active transcoder set for the current round
     */
    function setActiveTranscoders() external whenSystemNotPaused onlyRoundsManager returns (bool) {
        if (activeTranscoders.length != transcoderPools.candidateTranscoders.nodes.length) {
            // Set length of array if it has not already been set
            activeTranscoders.length = transcoderPools.candidateTranscoders.nodes.length;
        }

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
        }

        return true;
    }

    /*
     * @dev Distribute the token rewards to transcoder and delegates.
     * Active transcoders call this once per cycle when it is their turn.
     */
    function reward() external whenSystemNotPaused returns (bool) {
        // Current round must be initialized
        require(roundsManager().currentRoundInitialized());
        // Sender must be an active transcoder
        require(isActiveTranscoder[msg.sender]);

        Transcoder storage t = transcoders[msg.sender];

        uint256 currentRound = roundsManager().currentRound();

        // Transcoder must not have called reward for this round already
        require(t.lastRewardRound != currentRound);
        // Set last round that transcoder called reward
        t.lastRewardRound = currentRound;

        // Calculate number of tokens to mint
        uint256 mintedTokens = mintedTokensPerReward();
        /* // Mint token reward and allocate to this protocol contract */
        token.mint(this, mintedTokens);

        // Compute transcoder share of minted tokens
        uint256 transcoderRewardShare = mintedTokens.mul(t.blockRewardCut).div(100);
        // Update transcoder's reward pool for the current round
        RewardPool storage rewardPool = t.tokenPoolsPerRound[currentRound].rewardPool;
        rewardPool.rewards = rewardPool.rewards.add(mintedTokens.sub(transcoderRewardShare));

        if (rewardPool.transcoderTotalStake == 0) {
            rewardPool.transcoderTotalStake = transcoderTotalStake(msg.sender);
        }

        // Update transcoder stake with share of minted tokens
        t.bondedAmount = t.bondedAmount.add(transcoderRewardShare);
        // Update transcoder total bonded stake with minted tokens
        transcoderPools.increaseTranscoderStake(msg.sender, mintedTokens);

        return true;
    }

    /*
     * @dev Update transcoder's fee pool
     * @param _transcoder Transcoder address
     * @param _fees Fees from verified job claims
     */
    function updateTranscoderFeePool(
        address _transcoder,
        uint256 _fees,
        uint256 _claimBlock,
        uint256 _transcoderTotalStake
    )
        external
        whenSystemNotPaused
        onlyJobsManager
        returns (bool)
    {
        Transcoder storage t = transcoders[_transcoder];

        // Transcoder must be valid
        require(transcoderStatus(_transcoder) == TranscoderStatus.Registered);

        uint256 currentRound = roundsManager().currentRound();
        uint256 delegatorsFeeShare = _fees.mul(t.feeShare).div(100);

        t.tokenPoolsPerRound[currentRound].feePool.push(ClaimFees({
            claimBlock: _claimBlock,
            fees: delegatorsFeeShare,
            transcoderTotalStake: _transcoderTotalStake
        }));

        // Calculate transcoder fees including share of delegator fees based upon the amount it bonded to self
        uint256 transcoderFeeShare = _fees.sub(delegatorsFeeShare).add(delegatorsFeeShare.mul(t.bondedAmount).div(transcoderTotalStake(_transcoder)));
        // Update transcoder stake with fee share
        t.bondedAmount = t.bondedAmount.add(transcoderFeeShare);
        // Update transcoder total bonded stake with fee share
        transcoderPools.increaseTranscoderStake(_transcoder, _fees);

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
        whenSystemNotPaused
        onlyJobsManager
        returns (bool)
    {
        // Transcoder must be valid
        require(transcoderStatus(_transcoder) == TranscoderStatus.Registered);

        Transcoder storage t = transcoders[_transcoder];

        uint256 penalty = t.bondedAmount.mul(_slashAmount).div(100);

        if (penalty > t.bondedAmount) {
            // Decrease transcoder's total stake by transcoder's bond
            transcoderPools.decreaseTranscoderStake(_transcoder, t.bondedAmount);
            // Set transcoder's bond to 0 since
            // the penalty is greater than its bond
            t.bondedAmount = 0;
        } else {
            // Decrease transcoder's total stake by the penalty
            transcoderPools.decreaseTranscoderStake(_transcoder, penalty);
            // Decrease transcoder's bond
            t.bondedAmount = t.bondedAmount.sub(penalty);
        }

        // Set withdraw round for delegators
        transcoders[msg.sender].withdrawRound = roundsManager().currentRound().add(unbondingPeriod);

        if (transcoderPools.isInPools(msg.sender)) {
            // Remove transcoder from pools
            transcoderPools.removeTranscoder(msg.sender);
        }

        if (_finder != address(0)) {
            // Award finder fee
            token.transfer(_finder, penalty.mul(_finderFee).div(100));
        }

        return true;
    }

    /*
     * @dev Pseudorandomly elect a currently active transcoder that charges a price per segment less than or equal to the max price per segment for a job
     * Returns address of elected active transcoder and its price per segment
     * @param _maxPricePerSegment Max price (in LPT base units) per segment of a stream
     */
    function electActiveTranscoder(uint256 _maxPricePerSegment) external constant returns (address, uint256) {
        // Create array to store available transcoders charging an acceptable price per segment
        Node.Node[] memory availableTranscoders = new Node.Node[](activeTranscoders.length);
        // Keep track of the actual number of available transcoders
        uint256 numAvailableTranscoders = 0;
        // Kepp track of total stake of available transcoders
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
            return (address(0), 0);
        } else {
            // Pseudorandomly pick an available transcoder weighted by its stake relative to the total stake of all available transcoders
            uint256 r = uint256(block.blockhash(block.number - 1)) % totalAvailableTranscoderStake;
            uint256 s = 0;

            for (uint256 j = 0; j < numAvailableTranscoders; j++) {
                s = s.add(availableTranscoders[j].key);

                if (s > r) {
                    return (availableTranscoders[j].id, transcoders[availableTranscoders[j].id].pricePerSegment);
                }
            }

            return (availableTranscoders[numAvailableTranscoders - 1].id, transcoders[availableTranscoders[numAvailableTranscoders - 1].id].pricePerSegment);
        }

        return (address(0), 0);
    }

    /*
     * @dev Update delegator and transcoder stake with rewards from past rounds when a delegator calls bond() or unbond()
     * @param _target Address of delegator/transcoder
     */
    function updateDelegatorStake(address _delegator) public returns (bool) {
        Delegator storage del = delegators[_delegator];

        if (delegatorStatus(_delegator) == DelegatorStatus.Bonded) {
            del.bondedAmount = del.bondedAmount.add(delegatorTokenPoolsShare(del));
        }

        del.lastStakeUpdateRound = roundsManager().currentRound();

        return true;
    }

    /*
     * @dev Returns bonded stake for a delegator. Accounts for token distribution since last state transition
     * @param _delegator Address of delegator
     */
    function delegatorStake(address _delegator) public constant returns (uint256) {
        Delegator storage del = delegators[_delegator];

        // Must be valid delegator
        require(delegatorStatus(_delegator) == DelegatorStatus.Bonded);

        return del.bondedAmount.add(delegatorTokenPoolsShare(del));
    }

    /*
     * @dev Returns total bonded stake for an active transcoder
     * @param _transcoder Address of a transcoder
     */
    function activeTranscoderTotalStake(address _transcoder) public constant returns (uint256) {
        // Must be active transcoder
        require(isActiveTranscoder[_transcoder]);

        return activeTranscoders[activeTranscoderPositions[_transcoder]].key;
    }

    /*
     * @dev Returns total bonded stake for a transcoder
     * @param _transcoder Address of transcoder
     */
    function transcoderTotalStake(address _transcoder) public constant returns (uint256) {
        return transcoderPools.transcoderStake(_transcoder);
    }

    /*
     * @dev Computes transcoder status
     * @param _transcoder Address of transcoder
     */
    function transcoderStatus(address _transcoder) public constant returns (TranscoderStatus) {
        Transcoder storage t = transcoders[_transcoder];

        if (t.withdrawRound > 0) {
            // Transcoder resigned
            if (roundsManager().currentRound() >= t.withdrawRound) {
                return TranscoderStatus.Unbonded;
            } else {
                return TranscoderStatus.Unbonding;
            }
        } else if (t.transcoderAddress != address(0)) {
            // Transcoder registered
            return TranscoderStatus.Registered;
        } else {
            // Default to not registered
            return TranscoderStatus.NotRegistered;
        }
    }

    /*
     * @dev Computes delegator status
     * @param _delegator Address of delegator
     */
    function delegatorStatus(address _delegator) public constant returns (DelegatorStatus) {
        Delegator storage del = delegators[_delegator];

        if (del.withdrawRound > 0) {
            // Delegator called unbond
            if (roundsManager().currentRound() >= del.withdrawRound) {
                return DelegatorStatus.Unbonded;
            } else {
                return DelegatorStatus.Unbonding;
            }
        } else if (del.transcoderAddress != address(0) && transcoders[del.transcoderAddress].withdrawRound > 0) {
            // Transcoder resigned
            if (roundsManager().currentRound() >= transcoders[del.transcoderAddress].withdrawRound) {
                return DelegatorStatus.Unbonded;
            } else {
                return DelegatorStatus.Unbonding;
            }
        } else if (del.startRound > roundsManager().currentRound()) {
            // Delegator round start is in the future
            return DelegatorStatus.Pending;
        } else if (del.startRound <= roundsManager().currentRound()) {
            // Delegator round start is now or in the past
            return DelegatorStatus.Bonded;
        } else {
            // Default to not registered
            return DelegatorStatus.NotRegistered;
        }
    }

    /*
     * @dev Return number of minted tokens for a reward call
     */
    function mintedTokensPerReward() public constant returns (uint256) {
        return initialTokenSupply.mul(initialYearlyInflation).div(100).div(roundsManager().rewardCallsPerYear());
    }

    /*
     * @dev Computes token distribution for delegator since its last state transition
     * @param _delegator Address of delegator
     */
    function delegatorTokenPoolsShare(Delegator storage del) internal constant returns (uint256) {
        uint256 tokens = 0;

        if (del.transcoderAddress != address(0)) {
            // Iterate from round that delegator last transitioned states to current round
            // If the delegator is bonded to a transcoder, it has been bonded to the transcoder since lastStakeUpdateRound
            for (uint256 i = del.lastStakeUpdateRound; i <= roundsManager().currentRound(); i++) {
                tokens = tokens.add(delegatorRewardPoolShare(del, i)).add(delegatorFeePoolShare(del, i));
            }
        }

        return tokens;
    }

    /*
     * @dev Computes delegator's share of reward pool for a round
     */
    function delegatorRewardPoolShare(Delegator storage del, uint256 _round) internal constant returns (uint256) {
        RewardPool storage rewardPool = transcoders[del.transcoderAddress].tokenPoolsPerRound[_round].rewardPool;

        if (rewardPool.rewards == 0) {
            return 0;
        } else {
            return rewardPool.rewards.mul(del.bondedAmount).div(rewardPool.transcoderTotalStake);
        }
    }

    /*
     * @dev Computes delegator's share of fee pool for a round
     */
    function delegatorFeePoolShare(Delegator storage del, uint256 _round) internal constant returns (uint256) {
        ClaimFees[] storage feePool = transcoders[del.transcoderAddress].tokenPoolsPerRound[_round].feePool;

        if (feePool.length == 0) {
            return 0;
        } else {
            uint256 feeShare = 0;

            for (uint256 i = 0; i < feePool.length; i++) {
                // Fees are only claimable if delegator bonded to transcoder before claim submission
                if (del.delegateBlock < feePool[i].claimBlock) {
                    feeShare = feeShare.add(feePool[i].fees.mul(del.bondedAmount).div(feePool[i].transcoderTotalStake));
                }
            }

            return feeShare;
        }
    }

    /*
     * @dev Return rounds manager
     */
    function roundsManager() internal constant returns (IRoundsManager) {
        return IRoundsManager(ContractRegistry(registry).registry(keccak256("RoundsManager")));
    }

    /*
     * @dev Return jobs manager
     */
    function jobsManager() internal constant returns (IJobsManager) {
        return IJobsManager(ContractRegistry(registry).registry(keccak256("JobsManager")));
    }
}
