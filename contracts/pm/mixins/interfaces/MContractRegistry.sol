pragma solidity 0.8.4;

import "../../../bonding/IStakingManager.sol";
import "../../../token/IMinter.sol";
import "../../../rounds/IRoundsManager.sol";

abstract contract MContractRegistry {
    /**
     * @notice Checks if the system is paused
     * @dev Executes the 'whenSystemNotPaused' modifier 'MixinContractRegistry' inherits from 'Manager.sol'
     */
    modifier whenSystemNotPaused() virtual {
        _;
    }

    /**
     * @notice Checks if the current round has been initialized
     * @dev Executes the 'currentRoundInitialized' modifier in 'MixinContractRegistry'
     */
    modifier currentRoundInitialized() virtual {
        _;
    }

    /**
     * @dev Returns an instance of the IBondingManager interface
     */
    function stakingManager() internal view virtual returns (IStakingManager);

    /**
     * @dev Returns an instance of the IMinter interface
     */
    function minter() internal view virtual returns (IMinter);

    /**
     * @dev Returns an instance of the IRoundsManager interface
     */
    function roundsManager() internal view virtual returns (IRoundsManager);
}
