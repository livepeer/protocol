pragma solidity ^0.4.13;

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
        address transcoderAddress;      // The address of this transcoder
        uint256 bondedAmount;           // The amount they have bonded themselves
        uint256 withdrawRound; // The round at which delegators to this transcoder can withdraw if this transcoder resigns
        uint256 rewardRound;            // Last round that the transcoder called reward
        uint8 blockRewardCut;           // Percentage of token reward that delegators pay the transcoder
        uint8 feeShare;                 // Percentage of fees from broadcasting jobs that transcoder will share with delegators
        uint256 pricePerSegment;        // Lowest price transcoder is willing to accept for a job. Denominated in LPT base units
        uint8 pendingBlockRewardCut;    // Pending value for blockRewardCut to be set at the beginning of a new round
        uint8 pendingFeeShare;          // Pending value for feeShare to be set at the beginning of a new round
        uint256 pendingPricePerSegment; // Pending value for pricePerSegment to be set at the beginning of a new round
        mapping (uint256 => uint256[3]) tokenPoolsPerRound;  // Mapping of round => array of transcoder's reward pool, transcoder's fee pool, and transcoder's cumulative stake
        bool initialized;               // Is this transcoder initialized
    }

    enum TranscoderStatus { NotRegistered, Registered, Unbonding, Unbonded }

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
    enum DelegatorStatus { Inactive, Pending, Bonded, Unbonding, Unbonded }

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
    modifier roundsManagerOnly() {
        require(msg.sender == address(roundsManager()));
        _;
    }

    // Only the JobsManager can call
    modifier jobsManagerOnly() {
        require(msg.sender == address(jobsManager()));
        _;
    }

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
    function roundsManager() internal constant returns (IRoundsManager) {
        LivepeerProtocol protocol = LivepeerProtocol(controller);

        return IRoundsManager(protocol.getRegistryContract(protocol.roundsManagerKey()));
    }

    /*
     * @dev Return jobs manager contract
     */
    function jobsManager() internal constant returns (IJobsManager) {
        LivepeerProtocol protocol = LivepeerProtocol(controller);

        return IJobsManager(protocol.getRegistryContract(protocol.jobsManagerKey()));
    }

    // BONDING

    /*
     * @dev The sender is declaring themselves as a candidate for active transcoding.
     * @param _blockRewardCut Percentage of token reward that delegators pay the transcoder
     * @param _feeShare Percentage of fees from broadcasting jobs that transcoder will share with delegators
     * @param _pricePerSegment Lowest price transcoder is willing to accept for a job. Denominated in LPT base units
     */
    function transcoder(uint8 _blockRewardCut, uint8 _feeShare, uint256 _pricePerSegment) external returns (bool) {
        // Current round must be initialized
        require(roundsManager().currentRoundInitialized());
        // Block reward cut must a valid percentage
        require(_blockReward <= 100);
        // Fee share must be a valid percentage
        require(_feeShare <= 100);

        transcoders[msg.sender] = Transcoder({
            transcoderAddress: msg.sender,
            pendingBlockRewardCut: _blockRewardCut,
            pendingFeeShare: _feeShare,
            pendingPricePerSegment: _pricePerSegment,
            initialized: true
        });

        return true;
    }

    /*
     * @dev Remove the sender as a transcoder
     */
    function resignAsTranscoder() external returns (bool) {
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
    function bond(uint _amount, address _to) external returns (bool) {
        // Current round must be initialized
        require(roundsManager().currentRoundInitialized());
        // Must bond to a valid transcoder
        require(transcoders[_to].initialized);

        uint256 stakeForTranscoder = 0;

        if (transcoders[msg.sender].active && _to == msg.sender) {
            // Sender is a transcoder bonding to self
            transcoders[msg.sender].bondedAmount = transcoders[msg.sender].bondedAmount.add(_amount);
        } else {
            // Sender is not a transcoder
            updateDelegatorStake(msg.sender);
            // Update/create delegator
            Delegator storage del = delegators[msg.sender];

            if (!del.initialized || (del.transcoderAddress != address(0) && !transcoders[del.transcoder].initialized)) {
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
            del.delegatorAddress = msg.sender;
            del.transcoderAddress = _to;
            del.bondedAmount = del.bondedAmount.add(_amount);
            del.initialized = true;

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
    function unbond() external returns (bool) {
        // Current round must be initialized
        require(roundsManager().currentRoundInitialized());
        // Sender must be a valid delegator
        require(delegators[msg.sender].initialized);
        // Sender must be in bonded state
        require(delegatorStatus(msg.sender) == DelegatorStatus.Bonded);

        // Update delegator stake with token pools
        updateDelegatorStake(msg.sender);

        // Transition to unbonding phase
        delegators[msg.sender].withdrawRound = roundsManager().currentRound().add(unbondingPeriod);

        // Decrease transcoder total stake
        transcoderPools.decreaseTranscoderStake(delegators[msg.sender].transcoderAddress, delegators[msg.sender].bondedAmount);

        // Delegator no longer bonded to anyone
        delegators[msg.sender].transcoderAddress = address(0x0);

        return true;
    }

    /**
     * @dev Withdraws withdrawable funds back to the caller after unbonding period.
     */
    function withdraw() external returns (bool) {
        // Current round must be initialized
        require(roundsManager().currentRoundInitialized());

        if (transcoderStatus(msg.sender) != TranscoderStatus.NotRegistered) {
            // Sender is a transcoder
            // Transcoder must be unbonded
            require(transcoderStatus(msg.sender) == TranscoderStatus.Unbonded);

            token.transfer(msg.sender, transcdoers[msg.sender].bondedAmount);

            delete transcoders[msg.sender];
        } else if {
            // Sender is a delegator
            // Delegator must be unbonded
            require(delegatorStatus(msg.sender) == DelegatorStatus.Unbonded);

            token.transfer(msg.sender, delegators[msg.sender].bondedAmount);

            delete delegators[msg.sender];
        } else {
            // Sender is neither a transcoder or delegator
            revert();
        }

        return true;
    }

    function transcoderStatus(address _transcoder) public constant returns (TranscoderStatus) {
        Transcoder memory t = transcoders[_transcoder];

        if (t.withdrawRound > 0) {
            // Transcoder resigned
            if (roundsManager().currentRound() >= t.withdrawRound) {
                return TranscoderStatus.Unbonded;
            } else {
                return TranscoderStatus.Unbonding;
            }
        } else if (t.initialized) {
            return TranscoderStatus.Registered;
        } else {
            return TranscoderStatus.NotRegistered;
        }
    }

    /*
     * @dev Computes delegator status
     * @param _delegator Address of delegator
     */
    function delegatorStatus(address _delegator) public constant returns (DelegatorStatus) {
        Delegator memory del = delegators[_delegator];

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
        } else if (del.roundStart > roundsManager().currentRound()) {
            // Delegator round start is in the future
            return DelegatorStatus.Pending;
        } else if (del.roundStart <= roundsManager().currentRound()) {
            // Delegator round start is now or in the past
            return DelegatorStatus.Bonded;
        } else {
            // Delegator in inactive phase
            return DelegatorStatus.Inactive;
        }
    }

    // ELECTION

    /*
     * @dev Set active transcoder set for the current round
     */
    function setActiveTranscoders() roundsManagerOnly external returns (bool) {
        if (activeTranscoders.length != transcoderPools.candidateTranscoders.nodes.length) {
            // Set length of array if it has not already been set
            activeTranscoders.length = transcoderPools.candidateTranscoders.nodes.length;
        }

        totalActiveTranscoderStake = 0;

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

            totalActiveTranscoderStake = totalActiveTranscoderStake.add(activeTranscoders[i].key);
        }

        return true;
    }

    /*
     * @dev Pseudorandomly elect a currently active transcoder that charges a price per segment less than or equal to the max price per segment for a job
     * @param _maxPricePerSegment Max price (in LPT base units) per segment of a stream
     */
    function electActiveTranscoder(uint256 _maxPricePerSegment) public constant returns (address) {
        // Create array to store available transcoders charging an acceptable price per segment
        Node.Node[] memory availableTranscoders = new Node.Node[activeTranscoders.length];
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
            return address(0);
        } else {
            // Pseudorandomly pick an available transcoder weighted by its stake relative to the total stake of all available transcoders
            uint256 r = uint256(block.blockhash(block.number - 1)) % totalAvailableTranscoderStake;
            uint256 s = 0;

            for (uint256 i = 0; i < numAvailableTranscoders; i++) {
                s = s.add(availableTranscoders[i].key);

                if (s > r) {
                    return availableTranscoders[i].id;
                }
            }

            return availableTranscoders[numAvailableTranscoders - 1].id;
        }
    }

    /* // REWARDS & STAKES */

    /*
     * @dev Distribute the token rewards to transcoder and delegates.
     * Active transcoders call this once per cycle when it is their turn.
     */
    function reward() external returns (bool) {
        // Current round must be initialized
        require(roundsManager().currentRoundInitialized());
        // Sender must be an active transcoder
        require(isActiveTranscoder[msg.sender]);

        uint256 currentRound = roundsManager().currentRound();

        // Transcoder must not have called reward for this round already
        require(transcoders[msg.sender].rewardRound != currentRound);
        // Set last round that transcoder called reward
        transcoders[msg.sender].rewardRound = currentRound;

        // Calculate number of tokens to mint
        uint256 mintedTokens = mintedTokensPerReward();
        // Mint token reward and allocate to this protocol contract
        token.mint(this, mintedTokens);

        // Compute transcoder share of minted tokens
        uint256 transcoderRewardShare = mintedTokens.mul(transcoders[msg.sender].blockRewardCut).div(100);
        // Update transcoder's reward pool for the current round
        uint256[3] tokenPools = transcoders[msg.sender].tokenPools[currentRound];
        tokenPools[0] = tokenPools[0].add(mintedTokens.sub(transcoderRewardShare));

        if (tokenPools[2] == 0) {
            tokenPools[2] = activeTranscoderTotalStake(_transcoder);
        }

        transcoders[msg.sender].tokenPoolsPerRound[currentRound] = tokenPools;

        // Update transcoder stake with share of minted tokens
        transcoders[msg.sender].bondedAmount = transcoders[msg.sender].bondedAmount.add(transcoderRewardShare);
        // Update transcoder total bonded stake with minted tokens
        transcoderPools.increaseTranscoderStake(msg.sender, mintedTokens);

        return true;
    }

    /*
     * @dev Return number of minted tokens for a reward call
     */
    function mintedTokensPerReward() public constant returns (uint256) {
        return initialTokenSupply.mul(initialYearlyInflation).div(100).div(roundsManager().rewardCallsPerYear());
    }

    /*
     * @dev Update transcoder's fee pool
     * @param _transcoder Transcoder address
     * @param _fees Fees from verified job claims
     */
    function updateTranscoderFeePool(address _transcoder, uint256 _fees) onlyJobsManager external returns (bool) {
        // Transcoder must be valid
        require(transcoders[_transcoder].initialized);

        uint256 currentRound = roundsManager().currentRound();

        uint256[3] tokenPools = transcoders[msg.sender].tokenPoolsPerRound[currentRound];
        tokenPools[1] = tokenPools.add(_fees);

        if (tokenPools[2] == 0)  {
            tokenPools[2] = activeTranscoderTotalStake(_transcoder);
        }

        transcoders[msg.sender].tokenPoolsPerRound[currentRound] = tokenPools;

        return true;
    }

    /*
     * @dev Update delegator and transcoder stake with rewards from past rounds when a delegator calls bond() or unbond()
     * @param _target Address of delegator/transcoder
     */
    function updateDelegatorStake(address _delegator) internal returns (bool) {
        if (delegators[_delegator].initialized && delegators[_delegator].transcoderAddress != address(0)) {
            uint256 tokens = delegatorTokenPoolsShare(_delegator);

            // Update delegator stake with share of rewards
            delegators[_delegator].bondedAmount = delegators[_delegator].bondedAmount.add(tokens);
        }

        delegators[_delegator].lastStateTransitionRound = roundsManager().currentRound();

        return true;
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
     * @dev Returns bonded stake for a delegator. Accounts for token distribution since last state transition
     * @param _delegator Address of delegator
     */
    function delegatorStake(address _delegator) public constant returns (uint256) {
        // Must be valid delegator
        require(delegators[_delegator].initialized);

        return delegators[_delegator].bondedAmount.add(delegatorTokenPoolsShare(_delegator));
    }

    /*
     * @dev Computes token distribution for delegator since its last state transition
     * @param _delegator Address of delegator
     */
    function delegatorTokenPoolsShare(address _delegator) public constant returns (uint256) {
        uint256 tokens = 0;

        Delegator memory del = delegators[_delegator];

        // Check if delegator bonded to a transcoder
        if (del.transcoderAddress != address(0)) {
            // Iterate from round that delegator last transitioned states to current round
            // If the delegator is bonded to a transcoder, it has been bonded to the transcoder since lastStateTransitionRound
            for (uint256 i = del.lastStateTransitionRound; i <= roundsManager().currentRound(); i++) {
                uint256[3] tokenPools = transcoders[del.transcoderAddress].tokenPoolsPerRound[i];

                if (tokenPools[0] > 0) {
                    // Calculate delegator's share of reward
                    uint256 delegatorRewardShare = tokenPools[0].mul(del.bondedAmount).div(tokenPools[1]);

                    tokens = tokens.add(delegatorRewardShare);
                }

                if (tokenPools[1] > 0) {
                    // Calculate delegator's share of fees
                    uint256 delegatorFeeShare = tokenPools[1].mul(del.bondedAmount).div(tokenPools[2]);

                    tokens = tokens.add(delegatorFeeShare);
                }
            }
        }

        return tokens;
    }

    function slashTranscoder(address _transcoder, address _finder, uint64 _slashAmount, uint64 _finderFee) external returns (bool) {
        // Transcoder must be valid
        require(transcoderStatus(_transcoder) == TranscoderStatus.Registered);

        Transcoder storage t = transcoder[_transcoder];

        uint256 penalty = t.bondedAmount.mul(_percentage).div(100);

        // Decrease transcoder's stake
        t.bondedAmount = t.bondedAmount.sub(penalty);
        // Decrease transcoder's total stake
        transcoderPools.decreaseTranscoderStake(_transcoder, penalty);
        // Set withdraw round for delegators
        transcoders[msg.sender].delegatorWithdrawRound = roundsManager().currentRound().add(unbondingPeriod);

        if (transcoderPools.isInPools(msg.sender)) {
            // Remove transcoder from pools
            transcoderPools.removeTranscoder(msg.sender);
        }

        if (_finder != address(0)) {
            // Award finder fee
            token.transfer(_finder, penalty.mul(_finderFee).div(100));
        }

        return penalty;
    }
}
