pragma solidity ^0.4.11;

import "../Controllable.sol";
import "../LivepeerProtocol.sol";
import "./IRoundsManager.sol";
import "../bonding/IBondingManager.sol";

import "../../installed_contracts/zeppelin/contracts/SafeMath.sol";

contract RoundsManager is IRoundsManager, Controllable {
    using SafeMath for uint256;

    // Time between blocks. For testing purposes
    uint256 public blockTime;

    // Round length in blocks
    uint256 public roundLength;

    // Cycles in a round
    uint256 public cyclesPerRound;

    // Last initialized round. After first round, this is the last round during which initializeRound() was called
    uint256 public lastInitializedRound;

    // Number of active transcoders during a round
    uint256 public numActiveTranscoders;

    function RoundsManager() {
        // Set block time to 1 second for testing purposes
        blockTime = 1;
        // A round is 50 blocks for testing purposes
        roundLength = 50;
        // A round has 2 cycles for testing purposes
        cyclesPerRound = 2;
        // A round has 1 active transcoders for testing purposes
        numActiveTranscoders = 1;
        // Set last initialized round to current round
        lastInitializedRound = currentRound();
    }

    /*
     * @dev Return BondingManager contract (interface)
     */
    function bondingManager() internal constant returns (IBondingManager) {
        LivepeerProtocol protocol = LivepeerProtocol(controller);

        return IBondingManager(protocol.getRegistryContract(protocol.bondingManagerKey()));
    }

    /*
     * @dev Return current round
     */
    function currentRound() public constant returns (uint256) {
        return block.number / roundLength;
    }

    /*
     * @dev Return start block of current round
     */
    function currentRoundStartBlock() public constant returns (uint256) {
        return currentRound().mul(roundLength);
    }

    /*
     * @dev Return length in blocks of a time window for calling reward
     */
    function rewardTimeWindowLength() public constant returns (uint256) {
        return roundLength.div(cyclesPerRound.mul(numActiveTranscoders));
    }

    /*
     * @dev Return length in blocks of a cycle
     */
    function cycleLength() public constant returns (uint256) {
        return rewardTimeWindowLength().mul(numActiveTranscoders);
    }

    /*
     * @dev Return number of cycles since the start of round
     */
    function cycleNum() public constant returns (uint256) {
        return block.number.sub(currentRoundStartBlock()).div(cycleLength());
    }

    /*
     * @dev Return number of reward calls per year
     */
    function rewardCallsPerYear() public constant returns (uint256) {
        uint256 secondsInYear = 1 years;
        return secondsInYear.div(blockTime).div(roundLength).mul(cyclesPerRound).mul(numActiveTranscoders);
    }

    /*
     * @dev Checks if a time window is valid
     * @param _timeWindowIdx Index of time window
     */
    function validRewardTimeWindow(uint256 _timeWindowIdx) public constant returns (bool) {
        // Compute start block of reward time window for this cycle
        uint256 rewardTimeWindowStartBlock = currentRoundStartBlock().add(cycleNum().mul(cycleLength())).add(_timeWindowIdx.mul(rewardTimeWindowLength()));
        // Compute end block of reward time window for this cycle
        uint256 rewardTimeWindowEndBlock = rewardTimeWindowStartBlock.add(rewardTimeWindowLength());

        return block.number >= rewardTimeWindowStartBlock && block.number < rewardTimeWindowEndBlock;
    }

    /*
     * @dev Check if current round is initialized i.e. block.number / roundLength == lastInitializedRound
     */
    function currentRoundInitialized() public constant returns (bool)  {
        return lastInitializedRound == currentRound();
    }

    /*
     * @dev Initialize the current round. Called once at the start of any round
     */
    function initializeRound() external returns (bool) {
        // Check if already called for the current round
        // Will exit here to avoid large gas consumption if it has been called for the current round already
        if (lastInitializedRound == currentRound()) return false;
        // Set current round as initialized
        lastInitializedRound = currentRound();

        bondingManager().setActiveTranscoders();

        return true;
    }
}
