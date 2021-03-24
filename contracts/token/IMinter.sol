pragma solidity ^0.5.11;

import "../IController.sol";


/**
 * @title Minter interface
 */
contract IMinter {
    // External functions
    function mintTokens(uint256 _mintAmount) external;
    function trustedTransferTokens(address _to, uint256 _amount) external;
    function trustedBurnTokens(uint256 _amount) external;
    function trustedWithdrawETH(address payable _to, uint256 _amount) external;
    function depositETH() external payable returns (bool);
    function controller() external view returns (IController);
}
