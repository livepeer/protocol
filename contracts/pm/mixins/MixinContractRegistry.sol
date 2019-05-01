pragma solidity ^0.4.25;

import "../../ManagerProxyTarget.sol";
import "./interfaces/MContractRegistry.sol";


contract MixinContractRegistry is ManagerProxyTarget, MContractRegistry {
    constructor(address _controller)
        internal
        Manager(_controller)
    {}

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