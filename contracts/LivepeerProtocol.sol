pragma solidity ^0.4.8;

import "./LivepeerToken.sol";
import "./MinHeap.sol";
import "./MaxHeap.sol";
import '../installed_contracts/zeppelin/contracts/SafeMath.sol';

contract LivepeerProtocol is SafeMath {
    using MinHeap for MinHeap.Heap;
    using MaxHeap for MaxHeap.Heap;

    // Token address
    LivepeerToken public token;

    // Truebit address
    address public truebitAddress;

    /* Token constants */

    // 1 LPT == 10^18th units
    uint8 decimals = 18;

    // Start with 10M tokens
    uint256 public initialTokenSupply = 10000000 * (10 ** decimals);

    // Fixed inflation rate of 26%
    uint8 public initialYearlyInflation = 26;

    /* Protocol Parameters */

    // Segment length
    uint64 public t;

    // Number of active transcoders
    uint64 public n;

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
        address transcoderAddress;    // The address of this transcoder.
        uint256 bondedAmount;         // The amount they have bonded
        bool active;                  // Is this transcoder active. Also will be false if uninitialized

        // TODO: add all the state information about pricing, fee split, etc.
    }

    MinHeap.Heap public activeTranscoders;
    MaxHeap.Heap public candidateTranscoders;

    // The various states a delegator can be in
    enum DelegatorStatus { Inactive, Pending, Bonded, Unbonding }

    // Represents a delegator's current state
    struct Delegator {
        address delegatorAddress;       // The ethereum address of this delegator
        uint256 bondedAmount;           // The amount they have bonded
        address transcoderAddress;      // The ethereum address of the transcoder they are delgating towards
        uint256 roundStart;             // The round the delegator transitions to bonded phase
        uint256 withdrawRound;          // The round at which a delegator can withdraw
        bool initialized;               // Is this delegator initialized
    }

    // Keep track of the known transcoders and delegators
    // Note: Casper style implementation would have us using arrays and bitmaps to index these
    mapping (address => Delegator) public delegators;
    mapping (address => Transcoder) public transcoders;

    // Initialize protocol
    function LivepeerProtocol() {
        // Deploy new token contract
        token = new LivepeerToken();

        // Set truebit address
        truebitAddress = 0x647167a598171d06aecf0f5fa1daf3c5cc848df0;

        // Initialize parameters
        // Segment length of 2 seconds
        t = 2;

        // Start with 1 transcoder for testing
        n = 1;

        // Round length of ~1 day assuming ~17 second block time on main net
        // Current value is for testing purposes
        roundLength = 20;
        currentRound = block.number / roundLength;

        // Transcoder expected to call reward every ~10 minutes assuming ~17 second block time on main net
        // Current value is for testing purposes
        cyclesPerRound = roundLength / 2;

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

        // Setup initial transcoder
        address tAddr = 0xb7e5575ddb750db2722929905e790de65ef2c078;
        transcoders[tAddr] =
            Transcoder({transcoderAddress: tAddr, bondedAmount: 0, active: true});

        // Initialize transcoder pools
        activeTranscoders.init(n);
        activeTranscoders.insert(tAddr, 0);

        candidateTranscoders.init(n);

        // Do initial token distribution - currently clearly fake, minting 3 LPT to the contract creator
        token.mint(msg.sender, 3000000000000000000);

    }

    function delegatorStatus(address _delegator) constant returns (DelegatorStatus) {
        // Check if this is an initialized delegator
        if (delegators[_delegator].initialized == false) throw;

        if (delegators[_delegator].withdrawRound > 0) {
            // Delegator called unbond()
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

    /**
     * Delegate stake towards a specific address.
     * @param _amount The amount of LPT to stake.
     * @param _to The address of the transcoder to stake towards.
     */
    function bond(uint _amount, address _to) returns (bool) {
        // Check if this is a valid transcoder who is active
        if (transcoders[_to].active == false) throw;

        if (_amount > 0) {
            // Only transfer tokens if _amount is greater than 0
            // Transfer the token. This call throws if it fails.
            token.transferFrom(msg.sender, this, _amount);
        }

        // Update or create this delegator
        Delegator del = delegators[msg.sender];

        if (del.initialized == false) {
            // Only set round start if creating delegator for first time
            del.roundStart = (block.number / roundLength) + 2;
        }

        if (del.transcoderAddress != address(0) && _to != del.transcoderAddress) {
            // Decrease former transcoder cumulative stake
            decreaseTranscoderStake(del.transcoderAddress, del.bondedAmount);
        }

        del.delegatorAddress = msg.sender;
        del.transcoderAddress = _to;
        del.bondedAmount = safeAdd(del.bondedAmount, _amount);
        del.withdrawRound = 0;
        del.initialized = true;
        delegators[msg.sender] = del;

        // Increase transcoder cumulative stake
        increaseTranscoderStake(_to, _amount);

        return true;
    }

    /**
     * Unbond your current stake. This will enter the unbonding phase for
     * the unbondingPeriod.
     */
    function unbond() returns (bool) {
        // Check if this is an initialized delegator
        if (delegators[msg.sender].initialized == false) throw;
        // Check if delegator is in bonded status
        if (delegatorStatus(msg.sender) != DelegatorStatus.Bonded) throw;

        // Transition to unbonding phase
        delegators[msg.sender].withdrawRound = safeAdd(block.number / roundLength, unbondingPeriod);

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
        if (block.number / roundLength < delegators[msg.sender].withdrawRound) throw;

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

        return true;
    }

    /**
     * The sender is declaring themselves as a candidate for active transcoding.
     */
    function transcoder(uint256 _amount) returns (bool) {
        Transcoder t = transcoders[msg.sender];
        t.transcoderAddress = msg.sender;
        t.bondedAmount = safeAdd(t.bondedAmount, _amount);
        t.active = true;
        transcoders[msg.sender] = t;

        // Increase transcoder cumulative stake
        increaseTranscoderStake(msg.sender, _amount);

        return true;
    }

    function increaseTranscoderStake(address _transcoder, uint256 _amount) internal returns (bool) {
        if (activeTranscoders.contains(_transcoder)) {
            // Transcoder in active transcoder pool
            // Increase key
            activeTranscoders.increaseKey(_transcoder, safeAdd(activeTranscoders.getKey(_transcoder), _amount));
        } else if (activeTranscoders.size < n) {
            // Active transcoder pool is not full
            // Transcoder is not in active transcoder pool
            // Insert transcoder
            activeTranscoders.insert(_transcoder, _amount);
        } else {
            if (candidateTranscoders.contains(_transcoder)) {
                // Transcoder in candidate transcoder pool
                // Increase key
                candidateTranscoders.increaseKey(_transcoder, safeAdd(candidateTranscoders.getKey(_transcoder), _amount));
            } else if (candidateTranscoders.size < n) {
                // Candidate transcoder pool is not full
                // Transcoder is not in candidate transcoder pool
                // Insert transcoder
                candidateTranscoders.insert(_transcoder, _amount);
            } else {
                // Candidate transcoder pool is full
                throw;
            }

            // Get candidate transcoder with highest stake
            var (maxT, maxStake) = candidateTranscoders.max();

            if (_transcoder == maxT) {
                // Transcoder with increased stake is now candidate transcoder with highest stake
                // Get active transcoder with smallest stake
                var (minT, minStake) = activeTranscoders.min();

                if (maxStake > minStake) {
                    // Transcoder with increased stake has greater stake than active transcoder with smallest stake
                    // Remove active transcoder with smallest stake from active transcoder pool
                    activeTranscoders.extractMin();
                    // Add transcoder with increased stake to active transcoder pool
                    activeTranscoders.insert(maxT, maxStake);
                    // Remove transcoder with increased stake from candidate transcoder pool
                    candidateTranscoders.extractMax();
                    // Add active transcoder with smallest stake to candidate transcoder pool
                    candidateTranscoders.insert(minT, minStake);
                }
            }
        }

        return true;
    }

    function decreaseTranscoderStake(address _transcoder, uint256 _amount) returns (bool) {
        if (activeTranscoders.contains(_transcoder)) {
            // Transcoder in active transcoder pool
            // Decrease key
            activeTranscoders.decreaseKey(_transcoder, safeSub(activeTranscoders.getKey(_transcoder), _amount));

            // Get active transcoder with smallest stake
            var (minT, minStake) = activeTranscoders.min();

            if (candidateTranscoders.size > 0 && _transcoder == minT) {
                // Transcoder with decreased stake is now active transcoder with smallest stake
                // Get candidate transcoder with largest stake
                var (maxT, maxStake) = candidateTranscoders.max();

                if (minStake < maxStake) {
                    // Transcoder with decreased stake has less stake than candidate transcoder with largest stake
                    // Remove transcoder with decreased stake from active transcoder pool
                    activeTranscoders.extractMin();
                    // Add candidate transcoder with largest stake to active transcoder pool
                    activeTranscoders.insert(maxT, maxStake);
                    // Remove candidate transcoder with largest stake from candidate transcoder pool
                    candidateTranscoders.extractMax();
                    // Add transcoder with decreased stake to candidate transcoder pool
                    candidateTranscoders.insert(minT, minStake);
                }
            }
        } else if (candidateTranscoders.contains(_transcoder)) {
            // Transcoder in candidate transcoder pool
            // Decrease key
            candidateTranscoders.decreaseKey(_transcoder, safeSub(candidateTranscoders.getKey(_transcoder), _amount));
        } else {
            // Transcoder not in either transcoder pool
            throw;
        }

        return true;
    }

    function isActiveTranscoder(address _transcoder) constant returns (bool) {
        return activeTranscoders.contains(_transcoder);
    }

    function isCandidateTranscoder(address _transcoder) constant returns (bool) {
        return candidateTranscoders.contains(_transcoder);
    }

    /**
     * Called at the start of any round
     */
    function initializeRound(uint256 round) {
        // Check that the round has started
        if (round > block.number / roundLength || round != safeAdd(currentRound, 1)) throw;

        // Set the current round
        currentRound = round;
    }
}
