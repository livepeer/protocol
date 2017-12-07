pragma solidity ^0.4.17;

import "../ManagerProxyTarget.sol";
import "./IRoundsManager.sol";
import "../bonding/IBondingManager.sol";
import "../token/IMinter.sol";

import "zeppelin-solidity/contracts/math/SafeMath.sol";


contract RoundsManager is ManagerProxyTarget, IRoundsManager {
    using SafeMath for uint256;

    // Round length in blocks
    uint256 public roundLength;

    // Last initialized round. After first round, this is the last round during which initializeRound() was called
    uint256 public lastInitializedRound;

    function RoundsManager(address _controller) public Manager(_controller) {}

    /*
     * @dev Batch set protocol parameters. Only callable by the controller owner
     * @param _blockTime Time between blocks
     * @param _roundLength Round length in blocks
     */
    function setParameters(uint256 _roundLength) external onlyControllerOwner {
        roundLength = _roundLength;

        if (lastInitializedRound == 0) {
            lastInitializedRound = currentRound();
        }

        ParameterUpdate("all");
    }

    /*
     * @dev Set round length. Only callable by the controller owner
     * @param _roundLength Round length in blocks
     */
    function setRoundLength(uint256 _roundLength) external onlyControllerOwner {
        roundLength = _roundLength;

        ParameterUpdate("roundLength");
    }

    /*
     * @dev Initialize the current round. Called once at the start of any round
     */
    function initializeRound() external whenSystemNotPaused {
        uint256 currRound = currentRound();

        // Check if already called for the current round
        require(lastInitializedRound < currRound);

        // Set current round as initialized
        lastInitializedRound = currRound;

        bondingManager().setActiveTranscoders();
        minter().setCurrentRewardTokens();

        NewRound(currRound);
    }

    /*
     * @dev Return current round
     */
    function currentRound() public view returns (uint256) {
        return block.number.div(roundLength);
    }

    /*
     * @dev Return start block of current round
     */
    function currentRoundStartBlock() public view returns (uint256) {
        return currentRound().mul(roundLength);
    }

    /*
     * @dev Check if current round is initialized i.e. block.number / roundLength == lastInitializedRound
     */
    function currentRoundInitialized() public view returns (bool) {
        return lastInitializedRound == currentRound();
    }

    /*
     * @dev Return BondingManager contract (interface)
     */
    function bondingManager() internal view returns (IBondingManager) {
        return IBondingManager(controller.getContract(keccak256("BondingManager")));
    }

    function minter() internal view returns (IMinter) {
        return IMinter(controller.getContract(keccak256("Minter")));
    }
}
