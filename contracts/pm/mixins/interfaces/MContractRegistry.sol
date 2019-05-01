pragma solidity ^0.4.25;

import "../../../bonding/IBondingManager.sol";
import "../../../token/IMinter.sol";
import "../../../rounds/IRoundsManager.sol";


contract MContractRegistry {
    /**
     * @dev Returns an instance of the IBondingManager interface
     */
    function bondingManager() internal view returns (IBondingManager);

    /**
     * @dev Returns an instance of the IMinter interface
     */
    function minter() internal view returns (IMinter);

    /**
     * @dev Returns an instance of the IRoundsManager interface
     */
    function roundsManager() internal view returns (IRoundsManager);
}