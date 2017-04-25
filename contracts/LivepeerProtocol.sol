pragma solidity ^0.4.8;

import "./LivepeerToken.sol";


contract LivepeerProtocol {

    // Token address
    LivepeerToken public token;

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
    
    // Initialize protocol
    function LivepeerProtocol() {
        // Deploy new token contract
        token = new LivepeerToken();

        // Initialize parameters
        // Segment length of 2 seconds
        t = 2;

        // Start with 1 transcoder for testing
        n = 1;

        // Round length of 1 day, with transcoder expected to call reward every 10 minutes
        currentRound = 0;
        roundLength = 1 days;
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

        // Do initial token distribution
    }
}

