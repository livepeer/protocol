pragma solidity ^0.4.11;

import "./IBondingManager.sol";
import "../Controllable.sol";
import "../LivepeerProtocol.sol";
import "../LivepeerToken.sol";
import "../rounds/IRoundsManager.sol";
import "./libraries/TranscoderPools.sol";

import "../../installed_contracts/zeppelin/contracts/SafeMath.sol";

contract BondingManager is IBondingManager, Controllable {
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
        address transcoderAddress;      // The address of this transcoder.
        uint256 bondedAmount;           // The amount they have bonded themselves
        uint256 delegatorWithdrawRound; // The round at which delegators to this transcoder can withdraw if this transcoder resigns
        uint256 rewardRound;            // Last round that the transcoder called reward()
        uint256 rewardCycle;            // Last cycle of the last round that the transcoder called reward()
        uint8 blockRewardCut;           // Percentage of token reward that delegators pay the transcoder
        uint8 feeShare;                 // Percentage of fees from broadcasting jobs that transcoder will share with delegators
        uint256 pricePerSegment;        // Lowest price transcoder is willing to accept for a job. Denominated in LPT base units
        uint8 pendingBlockRewardCut;    // Pending value for blockRewardCut to be set at the beginning of a new round
        uint8 pendingFeeShare;          // Pending value for feeShare to be set at the beginning of a new round
        uint256 pendingPricePerSegment; // Pending value for pricePerSegment to be set at the beginning of a new round
        bool active;                    // Is this transcoder active. Also will be false if uninitialized
    }

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

    // The various states a delegator can be in
    enum DelegatorStatus { Inactive, Pending, Bonded, Unbonding }

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

    // Mapping to track transcoder's reward multiplier for a round
    // rewardMultiplier[0] -> total delegator token rewards for a round (minus transcoder share)
    // rewardMultiplier[1] -> transcoder's cumulative stake for round
    mapping (address => mapping (uint256 => uint256[2])) public rewardMultiplierPerTranscoderAndRound;

    /*
     * @dev BondingManager constructor. Sets a pre-existing address for the LivepeerToken contract
     * @param _token LivepeerToken contract address
     */
    function BondingManager(address _token, uint256 _numActiveTranscoders) {
        // Set LivepeerToken address
        token = LivepeerToken(_token);

        // Set unbonding period to 2 rounds. Current value is for testing purposes
        unbondingPeriod = 2;

        // Set up transcoder pools
        transcoderPools.init(_numActiveTranscoders, _numActiveTranscoders);
    }

    /*
     * @dev Return rounds manager contract
     */
    function roundsManager() constant returns (IRoundsManager) {
        LivepeerProtocol protocol = LivepeerProtocol(controller);

        return IRoundsManager(protocol.getRegistryContract(protocol.roundsManagerKey()));
    }

    // BONDING

    /**
     * @dev The sender is declaring themselves as a candidate for active transcoding.
     * @param _blockRewardCut Percentage of token reward that delegators pay the transcoder
     * @param _feeShare Percentage of fees from broadcasting jobs that transcoder will share with delegators
     * @param _pricePerSegment Lowest price transcoder is willing to accept for a job. Denominated in LPT base units
     */
    function transcoder(uint8 _blockRewardCut, uint8 _feeShare, uint256 _pricePerSegment) returns (bool) {
        // Check if current round is initialized
        if (!roundsManager().currentRoundInitialized()) throw;
        // Check for valid blockRewardCut
        if (_blockRewardCut > 100) throw;
        // Check for valid feeShare
        if (_feeShare > 100) throw;

        Transcoder t = transcoders[msg.sender];
        t.transcoderAddress = msg.sender;
        t.delegatorWithdrawRound = 0;
        t.rewardRound = 0;
        t.rewardCycle = 0;
        t.pendingBlockRewardCut = _blockRewardCut;
        t.pendingFeeShare = _feeShare;
        t.pendingPricePerSegment = _pricePerSegment;
        t.active = true;
        transcoders[msg.sender] = t;

        return true;
    }

    /*
     * @dev Remove the sender as a transcoder
     */
    function resignAsTranscoder() returns (bool) {
        // Check if current round is initialized
        if (!roundsManager().currentRoundInitialized()) throw;
        // Check if active transcoder
        if (transcoders[msg.sender].active == false) throw;

        // Go inactive
        transcoders[msg.sender].active = false;
        // Set withdraw round for delegators
        transcoders[msg.sender].delegatorWithdrawRound = roundsManager().currentRound().add(unbondingPeriod);
        // Zero out bonded amount
        transcoders[msg.sender].bondedAmount = 0;

        if (transcoderPools.isInPools(msg.sender)) {
            // Remove transcoder from pools
            transcoderPools.removeTranscoder(msg.sender);
        }
    }

    /**
     * @dev Delegate stake towards a specific address.
     * @param _amount The amount of LPT to stake.
     * @param _to The address of the transcoder to stake towards.
     */
    function bond(uint _amount, address _to) returns (bool) {
        // Check if current round is initialized
        if (!roundsManager().currentRoundInitialized()) throw;
        // Check if this is a valid transcoder who is active
        if (transcoders[_to].active == false) throw;

        // Update stakes with rewards thus far
        updateStakesWithRewards(msg.sender);

        if (_amount > 0) {
            // Only transfer tokens if _amount is greater than 0
            // Transfer the token. This call throws if it fails.
            token.transferFrom(msg.sender, this, _amount);
        }

        // Amount to be staked to transcoder
        uint256 stakeForTranscoder = _amount;

        if (transcoders[msg.sender].active == true && _to == msg.sender) {
            // Sender is a registered transcoder and is delegating to self
            transcoders[msg.sender].bondedAmount = transcoders[msg.sender].bondedAmount.add(_amount);
        } else {
            // Sender is not a registered transcoder
            // Update or create this delegator
            Delegator del = delegators[msg.sender];

            if (del.initialized == false ||
                (del.transcoderAddress != address(0) && transcoders[del.transcoderAddress].active == false)) {
                // Set round start if creating delegator for first time or if
                // delegator was bonded to an inactive transcoder
                del.roundStart = roundsManager().currentRound().add(1);
            }

            if (del.transcoderAddress != address(0) && _to != del.transcoderAddress) {
                // Delegator is moving bond
                // Set round start if delegator moves bond to another active transcoder
                del.roundStart = roundsManager().currentRound().add(1);
                // Decrease former transcoder cumulative stake
                transcoderPools.decreaseTranscoderStake(del.transcoderAddress, del.bondedAmount);
                // Stake amount includes delegator's total bonded amount since delegator is moving its bond
                stakeForTranscoder = stakeForTranscoder.add(del.bondedAmount);
            }

            del.delegatorAddress = msg.sender;
            del.transcoderAddress = _to;
            del.bondedAmount = del.bondedAmount.add(_amount);
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
     * @dev Unbond your current stake. You will enter the unbonding phase for
     * the unbondingPeriod.
     */
    function unbond() returns (bool) {
        // Check if current round is initialized
        if (!roundsManager().currentRoundInitialized()) throw;
        // Check if this is an initialized delegator
        if (delegators[msg.sender].initialized == false) throw;
        // Check if delegator is in bonded status
        if (delegatorStatus(msg.sender) != DelegatorStatus.Bonded) throw;

        // Update stakes with rewards thus far
        updateStakesWithRewards(msg.sender);

        // Transition to unbonding phase
        delegators[msg.sender].withdrawRound = roundsManager().currentRound().add(unbondingPeriod);

        // Decrease transcoder cumulative stake
        transcoderPools.decreaseTranscoderStake(delegators[msg.sender].transcoderAddress, delegators[msg.sender].bondedAmount);

        // No longer bonded to anyone
        delegators[msg.sender].transcoderAddress = address(0x0);

        return true;
    }

    /**
     * @dev Withdraws withdrawable funds back to the caller after unbonding period.
     */
    function withdraw() returns (bool) {
        // Check if current round is initialized
        if (!roundsManager().currentRoundInitialized()) throw;
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

    /*
     * @dev Computes delegator status
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
        } else if (delegators[_delegator].roundStart > roundsManager().currentRound()) {
            // Delegator round start is in the future
            // In pending phase
            return DelegatorStatus.Pending;
        } else if (delegators[_delegator].roundStart <= roundsManager().currentRound()) {
            // Delegator round start is now or in the past
            // In bonded phase
            return DelegatorStatus.Bonded;
        } else {
            // Delegator in inactive phase
            return DelegatorStatus.Inactive;
        }
    }

    /*
     * @dev Checks if delegator unbonding period is over
     * @param _delegator Address of delegator
     */
    function unbondingPeriodOver(address _delegator) constant returns (bool) {
        // Check if this is an initialized delegator
        if (delegators[_delegator].initialized == false) throw;

        if (delegators[_delegator].withdrawRound > 0) {
            // Delegator called unbond()
            return roundsManager().currentRound() >= delegators[_delegator].withdrawRound;
        } else if (delegators[_delegator].transcoderAddress != address(0)
                   && transcoders[delegators[_delegator].transcoderAddress].delegatorWithdrawRound > 0) {
            // Transcoder resigned
            return roundsManager().currentRound() >= transcoders[delegators[_delegator].transcoderAddress].delegatorWithdrawRound;
        } else {
            // Delegator not in unbonding state
            return false;
        }
    }

    /* // ELECTION */

    /*
     * @dev Set active transcoder set for the current round
     */
    function setActiveTranscoders() returns (bool) {
        // Check if sender is RoundsManager
        if (msg.sender != address(roundsManager())) throw;

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
            // Set pending blockRewardCut as actual value
            transcoders[activeTranscoder].blockRewardCut = transcoders[activeTranscoder].pendingBlockRewardCut;
            // Set pending feeShare as actual value
            transcoders[activeTranscoder].feeShare = transcoders[activeTranscoder].pendingFeeShare;
            // Set pending pricePerSegment as actual value
            transcoders[activeTranscoder].pricePerSegment = transcoders[activeTranscoder].pendingPricePerSegment;
        }

        return true;
    }

    /*
     * @dev Pseudorandomly elect a currently active transcoder that charges a price per segment less than or equal to the max price per segment for a job
     * @param _maxPricePerSegment Max price (in LPT base units) per segment of a stream
     */
    function electActiveTranscoder(uint256 _maxPricePerSegment) constant returns (address) {
        // Create array to store available transcoders charging an acceptable price per segment
        address[] memory availableTranscoders = new address[](activeTranscoders.length);
        // Keep track of the actual number of available transcoders
        uint256 numAvailableTranscoders = 0;

        for (uint256 i = 0; i < activeTranscoders.length; i++) {
            // If a transcoders charges an acceptable price per segment add it to the array of available transcoders
            if (transcoders[activeTranscoders[i].id].pricePerSegment <= _maxPricePerSegment) {
                availableTranscoders[numAvailableTranscoders] = activeTranscoders[i].id;
                numAvailableTranscoders++;
            }
        }

        if (numAvailableTranscoders == 0) {
            // There is no currently available transcoder that charges a price per segment less than or equal to the max price per segment for a job
            return address(0);
        } else {
            // Pseudorandomly select an available transcoder that charges an acceptable price per segment
            return availableTranscoders[uint256(block.blockhash(block.number.sub(1))) % numAvailableTranscoders];
        }
    }

    /* // REWARDS & STAKES */

    /*
     * @dev Distribute the token rewards to transcoder and delegates.
     * Active transcoders call this once per cycle when it is their turn.
     */
    function reward() returns (bool) {
        // Check if current round is initialized
        if (!roundsManager().currentRoundInitialized()) throw;
        // Check if in a valid transcoder reward time window
        if (!validRewardCall(msg.sender)) throw;

        uint256 currentRound = roundsManager().currentRound();
        uint256 cycleNum = roundsManager().cycleNum();

        /* // Set last round that transcoder called reward() */
        transcoders[msg.sender].rewardRound = currentRound;
        /* // Set last cycle of last round that transcoder called reward() */
        transcoders[msg.sender].rewardCycle = cycleNum;

        // Reward calculation
        // Calculate number of tokens to mint
        uint256 mintedTokens = mintedTokensPerReward();

        // Mint token reward and allocate to this protocol contract
        token.mint(this, mintedTokens);

        // Compute transcoder share of minted tokens
        uint256 transcoderRewardShare = mintedTokens.mul(transcoders[msg.sender].blockRewardCut).div(100);

        // Add remaining rewards (after transcoder share) for the current cycle of the current round to reward multiplier numerator
        uint256[2] rewardMultiplier = rewardMultiplierPerTranscoderAndRound[msg.sender][currentRound];
        rewardMultiplier[0] = rewardMultiplier[0].add(mintedTokens.sub(transcoderRewardShare));

        if (cycleNum == 0 || rewardMultiplier[1] == 0) {
            // First cycle of current round or reward multiplier denominator has not been set yet
            // Set transcoder cumulative stake for current round as denominator of reward multiplier for current round
            rewardMultiplier[1] = activeTranscoderTotalStake(msg.sender);
        }

        rewardMultiplierPerTranscoderAndRound[msg.sender][currentRound] = rewardMultiplier;

        // Update transcoder stake with share of minted tokens
        transcoders[msg.sender].bondedAmount = transcoders[msg.sender].bondedAmount.add(transcoderRewardShare);

        // Update transcoder total bonded stake with minted tokens
        transcoderPools.increaseTranscoderStake(msg.sender, mintedTokens);

        return true;
    }

    /*
     * @dev Return number of minted tokens for a reward call
     */
    function mintedTokensPerReward() constant returns (uint256) {
        return initialTokenSupply.mul(initialYearlyInflation).div(100).div(roundsManager().rewardCallsPerYear());
    }

    /*
     * @dev Check if transcoder is calling reward in correct range of blocks for its time window
     * @param _transcoder Address of transcoder
     */
    function validRewardCall(address _transcoder) constant returns (bool) {
        // Check if transcoder is in active set
        if (!isActiveTranscoder[_transcoder]) return false;
        // Check if already called for current cycle
        if (transcoders[_transcoder].rewardRound == roundsManager().currentRound() && transcoders[_transcoder].rewardCycle == roundsManager().cycleNum()) return false;

        // Get time window index
        uint256 timeWindowIdx = activeTranscoderPositions[_transcoder];

        return roundsManager().validRewardTimeWindow(timeWindowIdx);
    }

    /*
     * @dev Update delegator and transcoder stake with rewards from past rounds when a delegator calls bond() or unbond()
     * @param _target Address of delegator/transcoder
     */
    function updateStakesWithRewards(address _target) internal returns (bool) {
        if (delegators[_target].initialized && delegators[_target].transcoderAddress != address(0)) {
            uint256 rewards = delegatorRewards(_target);

            // Update delegator stake with share of rewards
            delegators[_target].bondedAmount = delegators[_target].bondedAmount.add(rewards);
        }

        delegators[_target].lastStateTransitionRound = roundsManager().currentRound();

        return true;
    }

    /*
     * @dev Returns total bonded stake for an active transcoder
     * @param _transcoder Address of a transcoder
     */
    function activeTranscoderTotalStake(address _transcoder) constant returns (uint256) {
        // Check if current active transcoder
        if (!isActiveTranscoder[_transcoder]) throw;

        return activeTranscoders[activeTranscoderPositions[_transcoder]].key;
    }

    /*
     * @dev Returns total bonded stake for a transcoder
     * @param _transcoder Address of transcoder
     */
    function transcoderTotalStake(address _transcoder) constant returns (uint256) {
        return transcoderPools.transcoderStake(_transcoder);
    }

    /*
     * @dev Returns bonded stake for a delegator. Accounts for rewards since last state transition
     * @param _delegator Address of delegator
     */
    function delegatorStake(address _delegator) constant returns (uint256) {
        // Check for valid delegator
        if (!delegators[_delegator].initialized) throw;

        return delegators[_delegator].bondedAmount.add(delegatorRewards(_delegator));
    }

    /*
     * @dev Computes rewards for a delegator since last state transition
     * @param _delegator Address of delegator
     */
    function delegatorRewards(address _delegator) internal constant returns (uint256) {
        uint256 rewards = 0;

        // Check if delegator bonded to a transcoder
        if (delegators[_delegator].transcoderAddress != address(0)) {
            // Iterate from round that delegator last transitioned states to current round
            // If the delegator is bonded to a transcoder, it has been bonded to the transcoder since lastStateTransitionRound
            for (uint256 i = delegators[_delegator].lastStateTransitionRound; i <= roundsManager().currentRound(); i++) {
                uint256[2] rewardMultiplier = rewardMultiplierPerTranscoderAndRound[delegators[_delegator].transcoderAddress][i];

                // Check if transcoder has a reward multiplier for this round (total minted tokens for round > 0)
                if (rewardMultiplier[0] > 0) {
                    // Calculate delegator's share of reward
                    uint256 delegatorShare = rewardMultiplier[0].mul(delegators[_delegator].bondedAmount).div(rewardMultiplier[1]);

                    rewards = rewards.add(delegatorShare);
                }
            }
        }

        return rewards;
    }
}
