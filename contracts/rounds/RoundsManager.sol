pragma solidity ^0.4.13;

import "../ManagerProxyTarget.sol";
import "./IRoundsManager.sol";
import "../bonding/IBondingManager.sol";

import "zeppelin-solidity/contracts/math/SafeMath.sol";


contract RoundsManager is ManagerProxyTarget, IRoundsManager {
    using SafeMath for uint256;

    // Time between blocks. For testing purposes
    uint256 public blockTime;

    // Round length in blocks
    uint256 public roundLength;

    // Last initialized round. After first round, this is the last round during which initializeRound() was called
    uint256 public lastInitializedRound;

    function RoundsManager(address _controller) Manager(_controller) {}

    function initialize(uint256 _blockTime, uint256 _roundLength) external beforeInitialization returns (bool) {
        blockTime = _blockTime;
        roundLength = _roundLength;
        lastInitializedRound = currentRound();
    }

    /*
     * @dev Initialize the current round. Called once at the start of any round
     */
    function initializeRound() external afterInitialization whenSystemNotPaused returns (bool) {
        // Check if already called for the current round
        // Will exit here to avoid large gas consumption if it has been called for the current round already
        // FIXME: replace with revert() after the Byzantium update which will return gas to the sender
        if (lastInitializedRound == currentRound()) {
            return false;
        }

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
    function roundsPerYear() public constant returns (uint256) {
        uint256 secondsInYear = 1 years;
        return secondsInYear.div(blockTime).div(roundLength);
    }

    /*
     * @dev Check if current round is initialized i.e. block.number / roundLength == lastInitializedRound
     */
    function currentRoundInitialized() public constant returns (bool) {
        return lastInitializedRound == currentRound();
    }

    /*
     * @dev Return BondingManager contract (interface)
     */
    function bondingManager() internal constant returns (IBondingManager) {
        return IBondingManager(controller.getContract(keccak256("BondingManager")));
    }
}
