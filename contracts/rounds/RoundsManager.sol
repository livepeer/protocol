pragma solidity ^0.4.17;

import "../ManagerProxyTarget.sol";
import "./IRoundsManager.sol";
import "../bonding/IBondingManager.sol";
import "../token/IMinter.sol";
import "../libraries/MathUtils.sol";

import "zeppelin-solidity/contracts/math/SafeMath.sol";


/**
 * @title RoundsManager
 * @dev Manages round progression and other blockchain time related operations of the Livepeer protocol
 */
contract RoundsManager is ManagerProxyTarget, IRoundsManager {
    using SafeMath for uint256;

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

    /**
     * @dev RoundsManager constructor. Only invokes constructor of base Manager contract with provided Controller address
     * @param _controller Address of Controller that this contract will be registered with
     */
    function RoundsManager(address _controller) public Manager(_controller) {}

    /**
     * @dev Set round length. Only callable by the controller owner
     * @param _roundLength Round length in blocks
     */
    function setRoundLength(uint256 _roundLength) external onlyControllerOwner {
        // Round length cannot be 0
        require(_roundLength > 0);

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

        ParameterUpdate("roundLength");
    }

    /**
     * @dev Set round lock amount. Only callable by the controller owner
     * @param _roundLockAmount Round lock amount as a % of the number of blocks in a round
     */
    function setRoundLockAmount(uint256 _roundLockAmount) external onlyControllerOwner {
        // Must be a valid percentage
        require(MathUtils.validPerc(_roundLockAmount));

        roundLockAmount = _roundLockAmount;

        ParameterUpdate("roundLockAmount");
    }

    /**
     * @dev Initialize the current round. Called once at the start of any round
     */
    function initializeRound() external whenSystemNotPaused {
        uint256 currRound = currentRound();

        // Check if already called for the current round
        require(lastInitializedRound < currRound);

        // Set current round as initialized
        lastInitializedRound = currRound;
        // Set active transcoders for the round
        bondingManager().setActiveTranscoders();
        // Set mintable rewards for the round
        minter().setCurrentRewardTokens();

        NewRound(currRound);
    }

    /**
     * @dev Return current block number
     */
    function blockNum() public view returns (uint256) {
        return block.number;
    }

    /**
     * @dev Return blockhash for a block
     */
    function blockHash(uint256 _block) public view returns (bytes32) {
        uint256 currentBlock = blockNum();
        // Can only retrieve past block hashes
        require(_block < currentBlock);
        // Can only retrieve hashes for last 256 blocks
        require(currentBlock < 256 || _block >= currentBlock - 256);

        return block.blockhash(_block);
    }

    /**
     * @dev Return current round
     */
    function currentRound() public view returns (uint256) {
        // Compute # of rounds since roundLength was last updated
        uint256 roundsSinceUpdate = blockNum().sub(lastRoundLengthUpdateStartBlock).div(roundLength);
        // Current round = round that roundLength was last updated + # of rounds since roundLength was last updated
        return lastRoundLengthUpdateRound.add(roundsSinceUpdate);
    }

    /**
     * @dev Return start block of current round
     */
    function currentRoundStartBlock() public view returns (uint256) {
        // Compute # of rounds since roundLength was last updated
        uint256 roundsSinceUpdate = blockNum().sub(lastRoundLengthUpdateStartBlock).div(roundLength);
        // Current round start block = start block of round that roundLength was last updated + (# of rounds since roundLenght was last updated * roundLength)
        return lastRoundLengthUpdateStartBlock.add(roundsSinceUpdate.mul(roundLength));
    }

    /**
     * @dev Check if current round is initialized
     */
    function currentRoundInitialized() public view returns (bool) {
        return lastInitializedRound == currentRound();
    }

    /**
     * @dev Check if we are in the lock period of the current round
     */
    function currentRoundLocked() public view returns (bool) {
        uint256 lockedBlocks = MathUtils.percOf(roundLength, roundLockAmount);
        return blockNum().sub(currentRoundStartBlock()) >= roundLength.sub(lockedBlocks);
    }

    /**
     * @dev Return BondingManager interface
     */
    function bondingManager() internal view returns (IBondingManager) {
        return IBondingManager(controller.getContract(keccak256("BondingManager")));
    }

    /**
     * @dev Return Minter interface
     */
    function minter() internal view returns (IMinter) {
        return IMinter(controller.getContract(keccak256("Minter")));
    }
}
