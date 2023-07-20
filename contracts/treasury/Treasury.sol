// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/governance/TimelockControllerUpgradeable.sol";

/**
 * @title Treasury
 * @notice Holder of the treasury and executor of proposals for the LivepeerGovernor.
 * @dev This was only really needed because TimelockControllerUpgradeable does not expose a public initializer, so we
 * need to inherit and expose the initialization function here.
 *
 * Even though this contract is upgradeable to fit with the rest of the contracts that expect upgradeable instances, it
 * is not used with a proxy, so we don't need to disable initializers in the constructor.
 */
contract Treasury is Initializable, TimelockControllerUpgradeable {
    function initialize(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) external initializer {
        __TimelockController_init(minDelay, proposers, executors, admin);
    }
}
