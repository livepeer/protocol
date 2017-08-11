pragma solidity ^0.4.13;

import "./IRoundsManager.sol";
import "../Manager.sol";
import "../ContractRegistry.sol";
import "../bonding/IBondingManager.sol";

import "zeppelin-solidity/contracts/math/SafeMath.sol";

contract RoundsManager is IRoundsManager, Manager {
    using SafeMath for uint256;

    // Time between blocks. For testing purposes
    uint256 public blockTime;

    // Round length in blocks
    uint256 public roundLength;

    // Last initialized round. After first round, this is the last round during which initializeRound() was called
    uint256 public lastInitializedRound;

    // Number of active transcoders during a round
    uint256 public numActiveTranscoders;

    function RoundsManager(address _registry) Manager(_registry) {
        // Set block time to 1 second for testing purposes
        blockTime = 1;
        // A round is 50 blocks for testing purposes
        roundLength = 50;
        // A round has 1 active transcoders for testing purposes
        numActiveTranscoders = 1;
        // Set last initialized round to current round
        lastInitializedRound = currentRound();
    }

    /*
     * @dev Initialize the current round. Called once at the start of any round
     */
    function initializeRound() external whenSystemNotPaused returns (bool) {
        // Check if already called for the current round
        // Will exit here to avoid large gas consumption if it has been called for the current round already
        if (lastInitializedRound == currentRound()) return false;
        // Set current round as initialized
        lastInitializedRound = currentRound();

        bondingManager().setActiveTranscoders();

        return true;
    }

    /*
     * @dev Return current round
     */
    function currentRound() public constant returns (uint256) {
        return block.number.div(roundLength);
    }

    /*
     * @dev Return start block of current round
     */
    function currentRoundStartBlock() public constant returns (uint256) {
        return currentRound().mul(roundLength);
    }

    /*
     * @dev Return number of reward calls per year
     */
    function rewardCallsPerYear() public constant returns (uint256) {
        uint256 secondsInYear = 1 years;
        return secondsInYear.div(blockTime).div(roundLength).mul(numActiveTranscoders);
    }

    /*
     * @dev Check if current round is initialized i.e. block.number / roundLength == lastInitializedRound
     */
    function currentRoundInitialized() public constant returns (bool)  {
        return lastInitializedRound == currentRound();
    }

    /*
     * @dev Return BondingManager contract (interface)
     */
    function bondingManager() internal constant returns (IBondingManager) {
        return IBondingManager(ContractRegistry(registry).registry(keccak256("BondingManager")));
    }
}
