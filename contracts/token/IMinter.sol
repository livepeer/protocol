// SPDX-FileCopyrightText: 2021 Livepeer <info@livepeer.org>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.4;

import "../IController.sol";

/**
 * @title Minter interface
 */
interface IMinter {
    // External functions
    function createReward(uint256 _fracNum, uint256 _fracDenom) external returns (uint256);

    function trustedTransferTokens(address _to, uint256 _amount) external;

    function trustedBurnTokens(uint256 _amount) external;

    function trustedWithdrawETH(address payable _to, uint256 _amount) external;

    function depositETH() external payable returns (bool);

    function setCurrentRewardTokens() external;

    function currentMintableTokens() external view returns (uint256);

    function currentMintedTokens() external view returns (uint256);

    function getController() external view returns (IController);
}
