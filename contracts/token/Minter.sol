pragma solidity ^0.5.11;

import "../Manager.sol";
import "./IMinter.sol";
import "./ILivepeerToken.sol";
import "../rounds/IRoundsManager.sol";
import "../bonding/IBondingManager.sol";
import "../libraries/MathUtilsV2.sol";

import "openzeppelin-solidity/contracts/math/SafeMath.sol";


/**
 * @title Minter
 * @dev Manages inflation rate and the minting of new tokens for each round of the Livepeer protocol
 */
contract Minter is Manager, IMinter {
    using SafeMath for uint256;

    // Per round inflation rate
    uint256 public inflation;
    // Change in inflation rate per round until the target bonding rate is achieved
    uint256 public inflationChange;
    // Target bonding rate
    uint256 public targetBondingRate;

    // Current number of mintable tokens. Reset every round
    uint256 public currentMintableTokens;
    // Current number of minted tokens. Reset every round
    uint256 public currentMintedTokens;

    // Checks if caller is BondingManager
    modifier onlyBondingManager() {
        require(msg.sender == controller.getContract(keccak256("BondingManager")), "msg.sender not BondingManager");
        _;
    }

    // Checks if caller is RoundsManager
    modifier onlyRoundsManager() {
        require(msg.sender == controller.getContract(keccak256("RoundsManager")), "msg.sender not RoundsManager");
        _;
    }

    // Checks if caller is either BondingManager or JobsManager
    modifier onlyBondingManagerOrJobsManager() {
        require(
            msg.sender == controller.getContract(keccak256("BondingManager")) || msg.sender == controller.getContract(keccak256("JobsManager")),
            "msg.sender not BondingManager or JobsManager"
        );
        _;
    }

    // Checks if caller is either the currently registered Minter or JobsManager
    modifier onlyMinterOrJobsManager() {
        require(
            msg.sender == controller.getContract(keccak256("Minter")) || msg.sender == controller.getContract(keccak256("JobsManager")),
            "msg.sender not Minter or JobsManager"
        );
        _;
    }

    // Checks if the caller is the currently registered InflationManager
    modifier onlyInflationManager() {
        require(msg.sender == controller.getContract(keccak256("InflationManager")), "msg.sender not InflationManager");
        _;
    }

    /**
     * @notice Minter constructor
     */
    constructor(address _controller) public Manager(_controller) {
    }

    /**
     * @notice Migrate to a new Minter by transferring ownership of the token as well
     * as the current Minter's token balance to the new Minter. Only callable by Controller when system is paused
     * @param _newMinter Address of new Minter
     */
    function migrateToNewMinter(IMinter _newMinter) external onlyControllerOwner whenSystemPaused {
        // New Minter cannot be the current Minter
        require(_newMinter != this, "new Minter cannot be current Minter");
        // Check for null address
        require(address(_newMinter) != address(0), "new Minter cannot be null address");

        IController newMinterController = _newMinter.controller();
        // New Minter must have same Controller as current Minter
        require(newMinterController == controller, "new Minter Controller must be current Controller");
        // New Minter's Controller must have the current Minter registered
        require(newMinterController.getContract(keccak256("Minter")) == address(this), "new Minter must be registered");

        // Transfer ownership of token to new Minter
        livepeerToken().transferOwnership(address(_newMinter));
        // Transfer current Minter's token balance to new Minter
        livepeerToken().transfer(address(_newMinter), livepeerToken().balanceOf(address(this)));
        // Transfer current Minter's ETH balance to new Minter
        _newMinter.depositETH.value(address(this).balance)();
    }

    /**
     * @notice Mint tokens based on the mint amount calculated by the InflationManager
     * @param _mintAmount amount of tokens to mint
     * @dev Only callable by the InflationManager when the system is not paused
    */
    function mintTokens(uint256 _mintAmount) external onlyInflationManager whenSystemNotPaused {
        livepeerToken().mint(address(this), _mintAmount);
    }

    /**
     * @notice Transfer tokens to a receipient. Only callable by BondingManager - always trusts BondingManager
     * @param _to Recipient address
     * @param _amount Amount of tokens
     */
    function trustedTransferTokens(address _to, uint256 _amount) external onlyBondingManager whenSystemNotPaused {
        livepeerToken().transfer(_to, _amount);
    }

    /**
     * @notice Burn tokens. Only callable by BondingManager - always trusts BondingManager
     * @param _amount Amount of tokens to burn
     */
    function trustedBurnTokens(uint256 _amount) external onlyBondingManager whenSystemNotPaused {
        livepeerToken().burn(_amount);
    }

    /**
     * @notice Withdraw ETH to a recipient. Only callable by BondingManager or TicketBroker - always trusts these two contracts
     * @param _to Recipient address
     * @param _amount Amount of ETH
     */
    function trustedWithdrawETH(address payable _to, uint256 _amount) external onlyBondingManagerOrJobsManager whenSystemNotPaused {
        _to.transfer(_amount);
    }

    /**
     * @notice Deposit ETH to this contract. Only callable by the currently registered Minter or JobsManager
     */
    function depositETH() external payable onlyMinterOrJobsManager returns (bool) {
        return true;
    }

    /**
     * @dev Returns Controller interface
     */
    function getController() public view returns (IController) {
        return controller;
    }

    /**
     * @dev Returns LivepeerToken interface
     */
    function livepeerToken() internal view returns (ILivepeerToken) {
        return ILivepeerToken(controller.getContract(keccak256("LivepeerToken")));
    }

    /**
     * @dev Returns BondingManager interface
     */
    function bondingManager() internal view returns (IBondingManager) {
        return IBondingManager(controller.getContract(keccak256("BondingManager")));
    }
}
