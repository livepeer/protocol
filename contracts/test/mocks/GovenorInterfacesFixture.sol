// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/governance/IGovernorUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/governance/extensions/IGovernorTimelockUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/IERC1155ReceiverUpgradeable.sol";

/**
 * @dev This is a helper contract to return the expected interface values that the LivepeerGovenor interface should
 * support. This only exists in Solidity since generating these interfaces in JS is kinda of a pain.
 */
contract GovernorInterfacesFixture {
    function TimelockUpgradeableInterface() external pure returns (bytes4) {
        return type(IGovernorTimelockUpgradeable).interfaceId;
    }

    /**
     * @dev ID calculation logic copied from {GovernorUpgradeable-supportsInterface}.
     */
    function GovernorInterfaces() external pure returns (bytes4[] memory) {
        IGovernorUpgradeable governor;
        // <begin of copy, replacing `this` with `governor`>
        bytes4 governorCancelId = governor.cancel.selector ^ governor.proposalProposer.selector;

        bytes4 governorParamsId = governor.castVoteWithReasonAndParams.selector ^
            governor.castVoteWithReasonAndParamsBySig.selector ^
            governor.getVotesWithParams.selector;

        // The original interface id in v4.3.
        bytes4 governor43Id = type(IGovernorUpgradeable).interfaceId ^
            type(IERC6372Upgradeable).interfaceId ^
            governorCancelId ^
            governorParamsId;

        // An updated interface id in v4.6, with params added.
        bytes4 governor46Id = type(IGovernorUpgradeable).interfaceId ^
            type(IERC6372Upgradeable).interfaceId ^
            governorCancelId;

        // For the updated interface id in v4.9, we use governorCancelId directly.
        // </end of copy>

        // replace the interface checks with return the expected interface ids
        bytes4[] memory ids = new bytes4[](4);
        ids[0] = governor43Id;
        ids[1] = governor46Id;
        ids[2] = governorCancelId;
        ids[3] = type(IERC1155ReceiverUpgradeable).interfaceId;
        return ids;
    }
}
