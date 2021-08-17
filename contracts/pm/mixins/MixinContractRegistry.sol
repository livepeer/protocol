pragma solidity 0.8.4;

import "../../ManagerProxyTarget.sol";
import "../../bonding/IBondingManager.sol";
import "../../token/IMinter.sol";
import "../../rounds/IRoundsManager.sol";

contract MixinContractRegistry is ManagerProxyTarget {
    /**
     * @dev Checks if the current round has been initialized
     */
    modifier currentRoundInitialized() {
        require(roundsManager().currentRoundInitialized(), "current round is not initialized");
        _;
    }

    constructor(address _controller) Manager(_controller) {}

    /**
     * @dev Returns an instance of the IBondingManager interface
     */
    function bondingManager() internal view returns (IBondingManager) {
        return IBondingManager(controller.getContract(keccak256("BondingManager")));
    }

    /**
     * @dev Returns an instance of the IMinter interface
     */
    function minter() internal view returns (IMinter) {
        return IMinter(controller.getContract(keccak256("Minter")));
    }

    /**
     * @dev Returns an instance of the IRoundsManager interface
     */
    function roundsManager() internal view returns (IRoundsManager) {
        return IRoundsManager(controller.getContract(keccak256("RoundsManager")));
    }
}
