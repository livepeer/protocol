pragma solidity ^0.4.8;

import "./LivepeerToken.sol";
import "./TranscoderPools.sol";
import "./Node.sol";
import '../installed_contracts/zeppelin/contracts/SafeMath.sol';

contract LivepeerProtocol is SafeMath {
    using TranscoderPools for TranscoderPools.TranscoderPools;

    // Token address
    LivepeerToken public token;

    // Truebit address
    address public truebitAddress;

    /* Token constants */

    // Start with 10M tokens. 1 LPT == 10^18th units
    uint256 public initialTokenSupply = 10000000 * (10 ** 18);

    // Fixed inflation rate of 26%
    uint8 public initialYearlyInflation = 26;

    /* Protocol Parameters */

    // Segment length
    uint64 public t;

    // Number of active transcoders
    uint64 public n;

    // Time between blocks. For testing purposes
    uint256 public blockTime;

    // Round length in blocks
    uint256 public roundLength;

    // Current round
    uint256 public currentRound;

    // Number of times each transcoder is expected to call Reward() in a round
    uint256 public cyclesPerRound;

    // Time before the start of a round that the transcoders rates lock
    uint64 public rateLockDeadline;

    // Time between unbonding and possible withdrawl in rounds
    uint64 public unbondingPeriod;

    // Time that data must be guaranteed in storage for verification
    uint64 public persistenceLength;

    // % of segments to be verified. 1 / verificationRate == % to be verified
    uint64 public verificationRate;

    // Slash % in the case of failed verification
    uint64 public failedVerificationSlashAmount;

    // Slash % in the case of failing to call Reward()
    uint64 public missedRewardSlashAmount;

    // Slash % in the case of missing a call to verification
    uint64 public missedVerificationSlashAmount;

    // % of tolerance for failing to do proper share of work
    uint64 public competitivenessTolerance;

    // % of verifications you can fail before being slashed
    uint64 public verificationFailureThreshold;

    // Represents a transcoder's current state
    struct Transcoder {
        address transcoderAddress;      // The address of this transcoder.
        uint256 bondedAmount;           // The amount they have bonded themselves
        uint256 delegatorWithdrawRound; // The round at which delegators to this transcoder can withdraw if this transcoder resigns
        uint256 rewardRound;            // Last round that the transcoder called reward()
        uint256 rewardCycle;            // Last cycle of the last round that the transcoder called reward()
        uint8 blockRewardCut;           // Percentage of token reward that delegators pay the transcoder
        bool active;                    // Is this transcoder active. Also will be false if uninitialized

        // TODO: add all the state information about pricing, fee split, etc.
    }

    // Active and candidate transcoder pools
    TranscoderPools.TranscoderPools transcoderPools;

    // The various states a delegator can be in
    enum DelegatorStatus { Inactive, Pending, Bonded, Unbonding }

    // Represents a delegator's current state
    struct Delegator {
        address delegatorAddress;          // The ethereum address of this delegator
        uint256 bondedAmount;              // The amount they have bonded
        address transcoderAddress;         // The ethereum address of the transcoder they are delgating towards
        uint256 roundStart;                // The round the delegator transitions to bonded phase
        uint256 withdrawRound;             // The round at which a delegator can withdraw
        uint256 lastStateTransitionRound;  // The last round the delegator transitioned states
        bool initialized;                  // Is this delegator initialized
    }

    // Keep track of the known transcoders and delegators
    // Note: Casper style implementation would have us using arrays and bitmaps to index these
    mapping (address => Delegator) public delegators;
    mapping (address => Transcoder) public transcoders;

    // Current active transcoders for current round
    Node.Node[] currentActiveTranscoders;
    // Mapping to track which addresses are in the current active transcoder set
    mapping (address => bool) isCurrentActiveTranscoder;
    // Mapping to track the index position of an address in the current active transcoder set
    mapping (address => uint256) currentActiveTranscoderPositions;

    // Mapping to track transcoder's reward multiplier for a round
    // rewardMultiplier[0] -> total minted tokens for round
    // rewardMultiplier[1] -> transcoder's cumulative stake for round
    mapping (address => mapping (uint256 => uint256[2])) public rewardMultiplierPerTranscoderAndRound;

    // Update delegator and transcoder stake with rewards from past rounds when a delegator calls bond() or unbond()
    modifier updateStakesWithRewards() {
        if (delegators[msg.sender].initialized && delegators[msg.sender].transcoderAddress != address(0)) {
            uint256 rewards = delegatorRewards(msg.sender);

            // Update delegator stake with share of rewards
            delegators[msg.sender].bondedAmount = safeAdd(delegators[msg.sender].bondedAmount, rewards);
        }

        delegators[msg.sender].lastStateTransitionRound = block.number / roundLength;

        _;
    }

    // Initialize protocol
    function LivepeerProtocol(uint64 _n, uint256 _roundLength, uint256 _cyclesPerRound) {
        // Deploy new token contract
        token = new LivepeerToken();

        // Set truebit address
        truebitAddress = 0x647167a598171d06aecf0f5fa1daf3c5cc848df0;

        // Initialize parameters
        // Segment length of 2 seconds
        t = 2;

        // Start with provided number of transcoders parameter
        // Current value is for testing purposes
        n = _n;

        // Set block time to 1 second for testing purposes
        blockTime = 1;

        // Round length of ~1 day assuming ~17 second block time on main net
        // Current value is for testing purposes
        roundLength = _roundLength;
        currentRound = block.number / roundLength;

        // Transcoder expected to call reward every ~10 minutes assuming ~17 second block time on main net
        // Current value is for testing purposes
        cyclesPerRound = _cyclesPerRound;

        // Lock rate changes 2 hours before round
        rateLockDeadline = 2 hours;

        // Unbond for ~10 days assuming ~17 second block time on main net
        // Current value is for testing purposes
        unbondingPeriod = 2;

        // Keep data in storage for 6 hours
        persistenceLength = 6 hours;

        // Verify 1/500 segments
        verificationRate = 500;

        // Slash percentages
        failedVerificationSlashAmount = 5;
        missedRewardSlashAmount = 3;
        missedVerificationSlashAmount = 10;

        // Expect transcoders to be 90% competitive
        competitivenessTolerance = 90;

        // Fail no more than 1% of the time
        verificationFailureThreshold = 1;

        // Initialize transcoder pools - size of candidate pool subject to change
        transcoderPools.init(n, n);

        // Do initial token distribution - currently clearly fake, minting 3 LPT to the contract creator
        token.mint(msg.sender, 3000000000000000000);
    }

    /*
     * Computes delegator status
     * @param _delegator Address of delegator
     */
    function delegatorStatus(address _delegator) constant returns (DelegatorStatus) {
        // Check if this is an initialized delegator
        if (delegators[_delegator].initialized == false) throw;

        if (delegators[_delegator].withdrawRound > 0 ||
            (delegators[_delegator].transcoderAddress != address(0)
             && transcoders[delegators[_delegator].transcoderAddress].delegatorWithdrawRound > 0)) {
            // Delegator called unbond() or transcoder resigned
            // In unbonding phase
            return DelegatorStatus.Unbonding;
        } else if (delegators[_delegator].roundStart > block.number / roundLength) {
            // Delegator round start is in the future
            // In pending phase
            return DelegatorStatus.Pending;
        } else if (delegators[_delegator].roundStart <= block.number / roundLength) {
            // Delegator round start is now or in the past
            // In bonded phase
            return DelegatorStatus.Bonded;
        } else {
            // Delegator in inactive phase
            return DelegatorStatus.Inactive;
        }
    }

    /*
     * Checks if delegator unbonding period is over
     * @param _delegator Address of delegator
     */
    function unbondingPeriodOver(address _delegator) constant returns (bool) {
        // Check if this is an initialized delegator
        if (delegators[_delegator].initialized == false) throw;

        if (delegators[_delegator].withdrawRound > 0) {
            // Delegator called unbond()
            return block.number / roundLength >= delegators[_delegator].withdrawRound;
        } else if (delegators[_delegator].transcoderAddress != address(0)
                   && transcoders[delegators[_delegator].transcoderAddress].delegatorWithdrawRound > 0) {
            // Transcoder resigned
            return block.number / roundLength >= transcoders[delegators[_delegator].transcoderAddress].delegatorWithdrawRound;
        } else {
            // Delegator not in unbonding state
            return false;
        }
    }

    /**
     * Delegate stake towards a specific address.
     * @param _amount The amount of LPT to stake.
     * @param _to The address of the transcoder to stake towards.
     */
    function bond(uint _amount, address _to) updateStakesWithRewards returns (bool) {
        // Check if this is a valid transcoder who is active
        if (transcoders[_to].active == false) throw;

        if (_amount > 0) {
            // Only transfer tokens if _amount is greater than 0
            // Transfer the token. This call throws if it fails.
            token.transferFrom(msg.sender, this, _amount);
        }

        // Amount to be staked to transcoder
        uint256 stakeForTranscoder = _amount;

        if (transcoders[msg.sender].active == true && _to == msg.sender) {
            // Sender is a registered transcoder and is delegating to self
            transcoders[msg.sender].bondedAmount = safeAdd(transcoders[msg.sender].bondedAmount, _amount);
        } else {
            // Sender is not a registered transcoder
            // Update or create this delegator
            Delegator del = delegators[msg.sender];

            if (del.initialized == false ||
                (del.transcoderAddress != address(0) && transcoders[del.transcoderAddress].active == false)) {
                // Set round start if creating delegator for first time or if
                // delegator was bonded to an inactive transcoder
                del.roundStart = (block.number / roundLength) + 1;
            }

            if (del.transcoderAddress != address(0) && _to != del.transcoderAddress) {
                // Delegator is moving bond
                // Set round start if delegator moves bond to another active transcoder
                del.roundStart = (block.number / roundLength) + 1;
                // Decrease former transcoder cumulative stake
                transcoderPools.decreaseTranscoderStake(del.transcoderAddress, del.bondedAmount);
                // Stake amount includes delegator's total bonded amount since delegator is moving its bond
                stakeForTranscoder = safeAdd(stakeForTranscoder, del.bondedAmount);
            }

            del.delegatorAddress = msg.sender;
            del.transcoderAddress = _to;
            del.bondedAmount = safeAdd(del.bondedAmount, _amount);
            del.withdrawRound = 0;
            del.initialized = true;
            delegators[msg.sender] = del;

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

        return true;
    }

    /**
     * Unbond your current stake. This will enter the unbonding phase for
     * the unbondingPeriod.
     */
    function unbond() updateStakesWithRewards returns (bool) {
        // Check if this is an initialized delegator
        if (delegators[msg.sender].initialized == false) throw;
        // Check if delegator is in bonded status
        if (delegatorStatus(msg.sender) != DelegatorStatus.Bonded) throw;

        // Transition to unbonding phase
        delegators[msg.sender].withdrawRound = safeAdd(block.number / roundLength, unbondingPeriod);

        // Decrease transcoder cumulative stake
        transcoderPools.decreaseTranscoderStake(delegators[msg.sender].transcoderAddress, delegators[msg.sender].bondedAmount);

        return true;
    }

    /**
     * Withdraws withdrawable funds back to the caller after unbonding period.
     */
    function withdraw() returns (bool) {
        // Check if this is an initialized delegator
        if (delegators[msg.sender].initialized == false) throw;
         // Check if delegator is in unbonding phase
        if (delegatorStatus(msg.sender) != DelegatorStatus.Unbonding) throw;
        // Check if delegator's unbonding period is over
        if (!unbondingPeriodOver(msg.sender)) throw;

        // Transfer token. This call throws if it fails.
        token.transfer(msg.sender, delegators[msg.sender].bondedAmount);

        // Delete delegator
        delete delegators[msg.sender];

        return true;
    }

    /**
     * Active transcoders call this once per cycle when it is their turn.
     * Distribute the token rewards to transcoder and delegates.
     */
    function reward() returns (bool) {
        // Check if in current round active transcoder set
        if (!isCurrentActiveTranscoder[msg.sender]) throw;

        // Check if already called for current cycle
        if (transcoders[msg.sender].rewardRound == block.number / roundLength && transcoders[msg.sender].rewardCycle == cycleNum()) throw;

        // Check if in a valid transcoder reward time window
        if (!validRewardTimeWindow(msg.sender)) throw;

        // Set last round that transcoder called reward()
        transcoders[msg.sender].rewardRound = block.number / roundLength;
        // Set last cycle of last round that transcoder called reward()
        transcoders[msg.sender].rewardCycle = cycleNum();

        // Reward calculation
        // Calculate number of tokens to mint
        uint256 mintedTokens = mintedTokensPerReward();

        // Mint token reward and allocate to this protocol contract
        token.mint(this, mintedTokens);

        // Compute transcoder share of minted tokens
        uint256 transcoderRewardShare = (mintedTokens * transcoders[msg.sender].blockRewardCut) / 100;

        // Add reminaing rewards (after transcoder share) for the current cycle of the current round to reward multiplier numerator
        uint256[2] rewardMultiplier = rewardMultiplierPerTranscoderAndRound[msg.sender][block.number / roundLength];
        rewardMultiplier[0] = safeAdd(rewardMultiplier[0], mintedTokens - transcoderRewardShare);

        if (cycleNum() == 0 || rewardMultiplier[1] == 0) {
            // First cycle of current round or reward multiplier denominator has not been set yet
            // Set transcoder cumulative stake for current round as denominator of reward multiplier for current round
            rewardMultiplier[1] = currentActiveTranscoderTotalStake(msg.sender);
        }

        rewardMultiplierPerTranscoderAndRound[msg.sender][block.number / roundLength] = rewardMultiplier;

        // Update transcoder stake with share of minted tokens
        transcoders[msg.sender].bondedAmount = safeAdd(transcoders[msg.sender].bondedAmount, transcoderRewardShare);

        // Update transcoder total bonded stake with minted tokens
        transcoderPools.increaseTranscoderStake(msg.sender, mintedTokens);

        return true;
    }

    function mintedTokensPerReward() constant returns (uint256) {
        uint256 rewardsPerYear = ((365 * 24 * 60 * 60) / blockTime / roundLength) * cyclesPerRound * n;
        return ((initialTokenSupply * initialYearlyInflation) / 100) / rewardsPerYear;
    }

    /**
     * The sender is declaring themselves as a candidate for active transcoding.
     */
    function transcoder(uint8 _blockRewardCut) returns (bool) {
        // Check for valid blockRewardCut
        if (_blockRewardCut < 0 || _blockRewardCut > 100) throw;

        Transcoder t = transcoders[msg.sender];
        t.transcoderAddress = msg.sender;
        t.delegatorWithdrawRound = 0;
        t.rewardRound = 0;
        t.rewardCycle = 0;
        t.blockRewardCut = _blockRewardCut;
        t.active = true;
        transcoders[msg.sender] = t;

        return true;
    }

    /*
     * Remove the sender as a transcoder
     */
    function resignAsTranscoder() returns (bool) {
        // Check if active transcoder
        if (transcoders[msg.sender].active == false) throw;

        // Go inactive
        transcoders[msg.sender].active = false;
        // Set withdraw round for delegators
        transcoders[msg.sender].delegatorWithdrawRound = safeAdd(block.number / roundLength, unbondingPeriod);
        // Zero out bonded amount
        transcoders[msg.sender].bondedAmount = 0;
        // Remove transcoder from pools
        transcoderPools.removeTranscoder(msg.sender);
    }

    /*
     * Checks if a transcoder is in active pool
     * @param _transcoder Address of transcoder
     */
    function isActiveTranscoder(address _transcoder) constant returns (bool) {
        return transcoderPools.activeTranscoders.ids[_transcoder];
    }

    /*
     * Checks if a transcoder is in candidate pool
     * @param _transcoder Address of transcoder
     */
    function isCandidateTranscoder(address _transcoder) constant returns (bool) {
        return transcoderPools.candidateTranscoders.ids[_transcoder];
    }

    /**
     * Called once at the start of any round
     */
    function initializeRound() returns (bool) {
        // Check if already called for the current round
        // Will exit here to avoid large gas consumption if it has been called for the current round already
        if (currentRound == block.number / roundLength) return false;
        // Set the current round
        currentRound = block.number / roundLength;

        // Set current round active transcoders
        setCurrentActiveTranscoders();

        return true;
    }

    /*
     * Set current active transcoder set for the current round
     */
    function setCurrentActiveTranscoders() internal returns (bool) {
        if (currentActiveTranscoders.length != transcoderPools.activeTranscoders.nodes.length) {
            // Set length of array if it has not already been set
            currentActiveTranscoders.length = transcoderPools.activeTranscoders.nodes.length;
        }

        for (uint256 i = 0; i < transcoderPools.activeTranscoders.nodes.length; i++) {
            if (currentActiveTranscoders[i].initialized) {
                // Set address of old node to not be present in current active transcoder set
                isCurrentActiveTranscoder[currentActiveTranscoders[i].id] = false;
            }
            // Copy node
            currentActiveTranscoders[i] = transcoderPools.activeTranscoders.nodes[i];
            // Set address of node to be present in current active transcoder set
            isCurrentActiveTranscoder[currentActiveTranscoders[i].id] = true;
            // Set index position of node in current active transcoder set
            currentActiveTranscoderPositions[currentActiveTranscoders[i].id] = i;
        }

        return true;
    }

    /*
     * Pseudorandomly elect an active transcoder. Currently a placeholder
     * TODO: take into account pricing, etc.
     */
    function electCurrentActiveTranscoder() constant returns (address) {
        return currentActiveTranscoders[uint(block.blockhash(block.number - 1)) % currentActiveTranscoders.length].id;
    }

    /*
     * Return start block of current round
     */
    function currentRoundStartBlock() constant returns (uint256) {
        return (block.number / roundLength) * roundLength;
    }

    /*
     * Return length in blocks of a time window for calling reward()
     */
    function rewardTimeWindowLength() constant returns (uint256) {
        return roundLength / (n * cyclesPerRound);
    }

    /*
     * Return length in blocks of a cycle
     */
    function cycleLength() constant returns (uint256) {
        return rewardTimeWindowLength() * n;
    }

    /*
     * Return number of cycles since the start of the round
     */
    function cycleNum() constant returns (uint256) {
        return (block.number - currentRoundStartBlock()) / cycleLength();
    }

    /*
     * Checks if a transcoder is calling reward() in the correct range of blocks
     * for its time window
     * @param _transcoder Address of transcoder
     */
    function validRewardTimeWindow(address _transcoder) internal returns (bool) {
        // Check if transcoder is present in current active transcoder set
        if (!isCurrentActiveTranscoder[_transcoder]) throw;

        // Use index position of address in current active transcoder set as its place in the order for calling reward()
        uint256 transcoderIdx = currentActiveTranscoderPositions[_transcoder];

        // Compute start block of reward time window for this cycle
        uint256 rewardTimeWindowStartBlock = currentRoundStartBlock() + (cycleNum() * cycleLength()) + (transcoderIdx * rewardTimeWindowLength());
        // Compute end block of reward time window for this cycle
        uint256 rewardTimeWindowEndBlock = rewardTimeWindowStartBlock + rewardTimeWindowLength();

        return block.number >= rewardTimeWindowStartBlock && block.number < rewardTimeWindowEndBlock;
    }

    /*
     * Returns total bonded stake for a current active transcoder
     * @param _transcoder Address of a transcoder
     */
    function currentActiveTranscoderTotalStake(address _transcoder) constant returns (uint256) {
        // Check if current active transcoder
        if (!isCurrentActiveTranscoder[_transcoder]) throw;

        return currentActiveTranscoders[currentActiveTranscoderPositions[_transcoder]].key;
    }

    /*
     * Returns total bonded stake for a transcoder
     * @param _transcoder Address of transcoder
     */
    function transcoderTotalStake(address _transcoder) constant returns (uint256) {
        return transcoderPools.transcoderStake(_transcoder);
    }

    /*
     * Returns bonded stake for a delegator. Accounts for rewards since last state transition
     * @param _delegator Address of delegator
     */
    function delegatorStake(address _delegator) constant returns (uint256) {
        // Check for valid delegator
        if (!delegators[_delegator].initialized) throw;

        return delegators[_delegator].bondedAmount + delegatorRewards(_delegator);
    }

    /*
     * Computes rewards for a delegator since last state transition
     * @param _delegator Address of delegator
     */
    function delegatorRewards(address _delegator) internal constant returns (uint256) {
        uint256 rewards = 0;

        // Check if delegator bonded to a transcoder
        if (delegators[_delegator].transcoderAddress != address(0)) {
            // Iterate from round that delegator last transitioned states to current round
            // If the delegator is bonded to a transcoder, it has been bonded to the transcoder since lastStateTransitionRound
            for (uint256 i = delegators[_delegator].lastStateTransitionRound; i <= block.number / roundLength; i++) {
                uint256[2] rewardMultiplier = rewardMultiplierPerTranscoderAndRound[delegators[_delegator].transcoderAddress][i];

                // Check if transcoder has a reward multiplier for this round (total minted tokens for round > 0)
                if (rewardMultiplier[0] > 0) {
                    // Calculate delegator's share of reward
                    uint256 delegatorShare = (rewardMultiplier[0] * delegators[_delegator].bondedAmount) / rewardMultiplier[1];

                    rewards = safeAdd(rewards, delegatorShare);
                }
            }
        }

        return rewards;
    }
}
