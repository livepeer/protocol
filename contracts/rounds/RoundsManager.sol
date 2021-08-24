// SPDX-FileCopyrightText: 2021 Livepeer <info@livepeer.org>

// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../ManagerProxyTarget.sol";
import "./IRoundsManager.sol";
import "../bonding/IBondingManager.sol";
import "../token/IMinter.sol";
import "../utils/MathUtils.sol";

/**
 * @title RoundsManager
 * @notice Manages round progression and other blockchain time related operations of the Livepeer protocol
 */
contract RoundsManager is IRoundsManager, ManagerProxyTarget {
    // Round length in blocks
    uint256 public roundLength;
    // Lock period of a round as a % of round length
    // Transcoders cannot join the transcoder pool or change their rates during the lock period at the end of a round
    // The lock period provides delegators time to review transcoder information without changes
    // # of blocks in the lock period = (roundLength * roundLockAmount) / PERC_DIVISOR
    uint256 public roundLockAmount;
    // Last initialized round. After first round, this is the last round during which initializeRound() was called
    uint256 public lastInitializedRound;
    // Round in which roundLength was last updated
    uint256 public lastRoundLengthUpdateRound;
    // Start block of the round in which roundLength was last updated
    uint256 public lastRoundLengthUpdateStartBlock;

    // Mapping round number => block hash for the round
    mapping(uint256 => bytes32) internal _blockHashForRound;

    // LIP Upgrade Rounds
    // These can be used in conditionals to ensure backwards compatibility or skip such backwards compatibility logic
    // in case 'currentRound' > LIP-X upgrade round
    mapping(uint256 => uint256) public override lipUpgradeRound; // mapping (LIP-number > round number)

    /**
     * @notice RoundsManager constructor. Only invokes constructor of base Manager contract with provided Controller address
     * @dev This constructor will not initialize any state variables besides `controller`. The following setter functions
     * should be used to initialize state variables post-deployment:
     * - setRoundLength()
     * - setRoundLockAmount()
     * @param _controller Address of Controller that this contract will be registered with
     */
    constructor(address _controller) Manager(_controller) {}

    /**
     * @notice Set round length. Only callable by the controller owner
     * @param _roundLength Round length in blocks
     */
    function setRoundLength(uint256 _roundLength) external onlyControllerOwner {
        require(_roundLength > 0, "round length cannot be 0");

        if (roundLength == 0) {
            // If first time initializing roundLength, set roundLength before
            // lastRoundLengthUpdateRound and lastRoundLengthUpdateStartBlock
            roundLength = _roundLength;
            lastRoundLengthUpdateRound = currentRound();
            lastRoundLengthUpdateStartBlock = currentRoundStartBlock();
        } else {
            // If updating roundLength, set roundLength after
            // lastRoundLengthUpdateRound and lastRoundLengthUpdateStartBlock
            lastRoundLengthUpdateRound = currentRound();
            lastRoundLengthUpdateStartBlock = currentRoundStartBlock();
            roundLength = _roundLength;
        }

        emit ParameterUpdate("roundLength");
    }

    /**
     * @notice Set round lock amount. Only callable by the controller owner
     * @param _roundLockAmount Round lock amount as a % of the number of blocks in a round
     */
    function setRoundLockAmount(uint256 _roundLockAmount) external onlyControllerOwner {
        require(MathUtils.validPerc(_roundLockAmount), "round lock amount must be a valid percentage");

        roundLockAmount = _roundLockAmount;

        emit ParameterUpdate("roundLockAmount");
    }

    /**
     * @notice Initialize the current round. Called once at the start of any round
     */
    function initializeRound() external override whenSystemNotPaused {
        uint256 currRound = currentRound();

        // Check if already called for the current round
        require(lastInitializedRound < currRound, "round already initialized");

        // Set current round as initialized
        lastInitializedRound = currRound;
        // Store block hash for round
        bytes32 roundBlockHash = blockHash(blockNum() - 1);
        _blockHashForRound[currRound] = roundBlockHash;
        // Set total active stake for the round
        bondingManager().setCurrentRoundTotalActiveStake();
        // Set mintable rewards for the round
        minter().setCurrentRewardTokens();

        emit NewRound(currRound, roundBlockHash);
    }

    /**
     * @notice setLIPUpgradeRound sets the round an LIP upgrade would become active.
     * @param _lip the LIP number.
     * @param _round (optional) the round in which the LIP becomes active
     */
    function setLIPUpgradeRound(uint256 _lip, uint256 _round) external onlyControllerOwner {
        require(lipUpgradeRound[_lip] == 0, "LIP upgrade round already set");
        lipUpgradeRound[_lip] = _round;
    }

    /**
     * @notice Return current block number
     */
    function blockNum() public view virtual override returns (uint256) {
        return block.number;
    }

    /**
     * @notice Return blockhash for a block
     */
    function blockHash(uint256 _block) public view virtual override returns (bytes32) {
        uint256 currentBlock = blockNum();
        require(_block < currentBlock, "can only retrieve past block hashes");
        require(currentBlock < 256 || _block >= currentBlock - 256, "can only retrieve hashes for last 256 blocks");

        return blockhash(_block);
    }

    /**
     * @notice Return blockhash for a round
     * @param _round Round number
     * @return Blockhash for `_round`
     */
    function blockHashForRound(uint256 _round) public view override returns (bytes32) {
        return _blockHashForRound[_round];
    }

    /**
     * @notice Return current round
     */
    function currentRound() public view override returns (uint256) {
        // Compute # of rounds since roundLength was last updated
        uint256 roundsSinceUpdate = _roundsSinceUpdate();
        // Current round = round that roundLength was last updated + # of rounds since roundLength was last updated
        return lastRoundLengthUpdateRound + roundsSinceUpdate;
    }

    /**
     * @notice Return start block of current round
     */
    function currentRoundStartBlock() public view override returns (uint256) {
        // Compute # of rounds since roundLength was last updated
        uint256 roundsSinceUpdate = _roundsSinceUpdate();
        // Current round start block = start block of round that roundLength was last updated + (# of rounds since roundLenght was last updated * roundLength)
        return lastRoundLengthUpdateStartBlock + roundsSinceUpdate * roundLength;
    }

    /**
     * @notice Check if current round is initialized
     */
    function currentRoundInitialized() public view override returns (bool) {
        return lastInitializedRound == currentRound();
    }

    /**
     * @notice Check if we are in the lock period of the current round
     */
    function currentRoundLocked() public view override returns (bool) {
        uint256 lockedBlocks = MathUtils.percOf(roundLength, roundLockAmount);
        return blockNum() - currentRoundStartBlock() >= roundLength - lockedBlocks;
    }

    /**
     * @dev Return BondingManager interface
     */
    function bondingManager() internal view returns (IBondingManager) {
        return IBondingManager(controller.getContract(keccak256("BondingManager")));
    }

    function _roundsSinceUpdate() internal view returns (uint256) {
        return blockNum() - lastRoundLengthUpdateStartBlock / roundLength;
    }

    /**
     * @dev Return Minter interface
     */
    function minter() internal view returns (IMinter) {
        return IMinter(controller.getContract(keccak256("Minter")));
    }
}
