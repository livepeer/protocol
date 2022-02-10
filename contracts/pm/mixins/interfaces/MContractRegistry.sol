// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../../../bonding/IBondingManager.sol";
import "../../../token/IMinter.sol";
import "../../../rounds/IRoundsManager.sol";

abstract contract MContractRegistry {
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
    function bondingManager() internal view virtual returns (IBondingManager);

    /**
     * @dev Returns an instance of the IMinter interface
     */
    function minter() internal view virtual returns (IMinter);

    /**
     * @dev Returns an instance of the IRoundsManager interface
     */
    function roundsManager() internal view virtual returns (IRoundsManager);
}
