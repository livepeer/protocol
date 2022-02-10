// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../../ManagerProxyTarget.sol";
import "./interfaces/MContractRegistry.sol";

abstract contract MixinContractRegistry is MContractRegistry, ManagerProxyTarget {
    /**
     * @dev Checks if the current round has been initialized
     */
    modifier currentRoundInitialized() override {
        require(roundsManager().currentRoundInitialized(), "current round is not initialized");
        _;
    }

    constructor(address _controller) Manager(_controller) {}

    /**
     * @dev Returns an instance of the IBondingManager interface
     */
    function bondingManager() internal view override returns (IBondingManager) {
        return IBondingManager(controller.getContract(keccak256("BondingManager")));
    }

    /**
     * @dev Returns an instance of the IMinter interface
     */
    function minter() internal view override returns (IMinter) {
        return IMinter(controller.getContract(keccak256("Minter")));
    }

    /**
     * @dev Returns an instance of the IRoundsManager interface
     */
    function roundsManager() internal view override returns (IRoundsManager) {
        return IRoundsManager(controller.getContract(keccak256("RoundsManager")));
    }
}
