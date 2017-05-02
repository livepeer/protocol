pragma solidity ^0.4.8;

import "./LivepeerToken.sol";
import '../installed_contracts/zeppelin/contracts/SafeMath.sol';

contract LivepeerProtocol is SafeMath {

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

    // Round length in seconds
    uint64 public roundLength;

    // Current round
    uint64 public currentRound;

    // Mapping of round number with start timestamp of round
    uint256[] public roundStartTimestamps;

    // Number of times each transcoder is expected to call Reward() in a round
    uint64 public cyclesPerRound;

    // Time before the start of a round that the transcoders rates lock
    uint64 public rateLockDeadline;

    // Time between unbonding and possible withdrawl
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
        address transcoder_address;    // The address of this transcoder.
        bool active;                   // Is this transcoder active. Also will be false if uninitialized

        // TODO: add all the state information about pricing, fee split, etc.
    }

    // The various states a delegator can be in
    enum DelegatorStatus { Inactive, Pending, Bonded, Unbonding }

    // Represents a delegator's current state
    struct Delegator {
        address delegator_address;       // The ethereum address of this delegator
        uint256 bonded_amount;           // The amount they have bonded
        address transcoder_address;      // The ethereum address of the transcoder they are delgating towards
        DelegatorStatus status;          // Their current state
        uint64 round_start;             // The round the delegator transitions to bonded phase
        uint256 withdraw_timestamp;      // The timestamp at which a delegator can withdraw
        bool active;                     // Is this delegator active. Also will be false if uninitialized
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

        // Round length of 1 day, with transcoder expected to call reward every 10 minutes
        currentRound = 0;
        roundLength = 1 days;
        roundStartTimestamps.push(block.timestamp);
        cyclesPerRound = roundLength / 10 minutes;

        // Lock rate changes 2 hours before round
        rateLockDeadline = 2 hours;

        // Unbond for 10 days
        unbondingPeriod = 10 days;

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
        address t_addr = 0xb7e5575ddb750db2722929905e790de65ef2c078;
        transcoders[t_addr] =
            Transcoder({transcoder_address: t_addr, active: true});

        // Do initial token distribution - currently clearly fake, minting 3 LPT to the contract creator
        token.mint(msg.sender, 3000000000000000000);

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

        if (del.active == false) {
            // Only transition to pending if creating delegator for first time
            del.status = DelegatorStatus.Pending;
            // Only set round start if creating delegator for first time
            del.round_start = currentRound + 2;
        }

        del.delegator_address = msg.sender;
        del.transcoder_address = _to;
        del.bonded_amount = safeAdd(del.bonded_amount, _amount);
        del.withdraw_timestamp = 0;
        del.active = true;
        delegators[msg.sender] = del;

        return true;
    }

    /**
     * Finalize bond and transition a delegator to the bonded phase
     * Can only be called if it has been 2 rounds since a delegator originally bonded
     */
    function finalizeBond() returns (bool) {
        // Check if delegator is in pending phase
        if (delegators[msg.sender].status != DelegatorStatus.Pending) throw;
        // Check if the current round is the delegator's start round
        if (delegators[msg.sender].round_start < currentRound) throw;

        delegators[msg.sender].status = DelegatorStatus.Bonded;

        return true;
    }

    /**
     * Unbond your current stake. This will enter the unbonding phase for
     * the unbondingPeriod.
     */
    function unbond() returns (bool) {
        // Check if this is an active delegator
        if (delegators[msg.sender].active == false) throw;
        // Check if delegator is in bonded status
        if (delegators[msg.sender].status != DelegatorStatus.Bonded) throw;

        // Transition to unbonding phase
        delegators[msg.sender].status = DelegatorStatus.Unbonding;
        delegators[msg.sender].withdraw_timestamp = block.timestamp + unbondingPeriod;

        return true;
    }

    /**
     * Withdraws withdrawable funds back to the caller after unbonding period.
     */
    function withdraw() returns (bool) {
        // Check if this is an active delegator
        if (delegators[msg.sender].active == false) throw;
        // Check if active delegator is in unbonding phase
        if (delegators[msg.sender].status != DelegatorStatus.Unbonding) throw;
        // Check if active delegator's unbonding period is over
        if (block.timestamp < delegators[msg.sender].withdraw_timestamp) throw;

        // Transfer token. This call throws if it fails.
        token.transfer(msg.sender, delegators[msg.sender].bonded_amount);

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
    function transcoder() returns (bool) {
        transcoders[msg.sender] = Transcoder({transcoder_address: msg.sender, active: true});
        return true;
    }

    /**
     * Move to the next round
     * Can only be called if the current round is over
     */
    function nextRound() {
        // Check if current round is over
        if (block.timestamp < roundStartTimestamps[currentRound] + roundLength) throw;

        currentRound += 1;
        roundStartTimestamps.push(block.timestamp);
    }
}
