pragma solidity ^0.4.17;

import "../Manager.sol";
import "./IMinter.sol";
import "./ILivepeerToken.sol";
import "../rounds/IRoundsManager.sol";
import "../bonding/IBondingManager.sol";
import "../libraries/MathUtils.sol";

import "zeppelin-solidity/contracts/math/SafeMath.sol";


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

    modifier onlyBondingManager() {
        require(msg.sender == controller.getContract(keccak256("BondingManager")));
        _;
    }

    modifier onlyJobsManager() {
        require(msg.sender == controller.getContract(keccak256("JobsManager")));
        _;
    }

    modifier onlyRoundsManager() {
        require(msg.sender == controller.getContract(keccak256("RoundsManager")));
        _;
    }

    modifier onlyBondingManagerOrJobsManager() {
        require(msg.sender == controller.getContract(keccak256("BondingManager")) || msg.sender == controller.getContract(keccak256("JobsManager")));
        _;
    }

    function Minter(address _controller, uint256 _inflation, uint256 _inflationChange, uint256 _targetBondingRate) public Manager(_controller) {
        // Inflation must be valid percentage
        require(MathUtils.validPerc(_inflation));
        // Inflation change must be valid percentage
        require(MathUtils.validPerc(_inflationChange));
        // Target bonding rate must be valid percentage
        require(MathUtils.validPerc(_targetBondingRate));

        inflation = _inflation;
        inflationChange = _inflationChange;
        targetBondingRate = _targetBondingRate;
    }

    function setTargetBondingRate(uint256 _targetBondingRate) external onlyControllerOwner {
        // Must be valid percentage
        require(MathUtils.validPerc(_targetBondingRate));

        targetBondingRate = _targetBondingRate;

        ParameterUpdate("targetBondingRate");
    }

    function transferTokenOwnership(address _newOwner) external onlyControllerOwner {
        livepeerToken().transferOwnership(_newOwner);
    }

    /*
     * @dev Create reward based on a fractional portion of the mintable tokens and redistributable funds for a round
     * @param _fracNum Numerator of fraction (active transcoder's stake)
     * @param _fracDenom Denominator of fraction (total active stake)
     */
    function createReward(uint256 _fracNum, uint256 _fracDenom) external onlyBondingManager whenSystemNotPaused returns (uint256) {
        // Compute and mint fraction of mintable tokens to include in reward
        uint256 mintAmount = MathUtils.percOf(currentMintableTokens, _fracNum, _fracDenom);
        // Update amount of minted tokens for round
        currentMintedTokens = currentMintedTokens.add(mintAmount);
        // Minted tokens must not exceed mintable tokens
        require(currentMintedTokens <= currentMintableTokens);
        // Mint new tokens
        livepeerToken().mint(this, mintAmount);

        // Reward = minted tokens
        return mintAmount;
    }

    /*
     * @dev Transfer tokens to a receipient
     * @param _to Recipient address
     * @param _amount Amount of tokens
     */
    function transferTokens(address _to, uint256 _amount) external onlyBondingManagerOrJobsManager whenSystemNotPaused {
        livepeerToken().transfer(_to, _amount);
    }

    /*
     * @dev Burn tokens
     * @param _amount Amount of tokens to burn
     */
    function burnTokens(uint256 _amount) external onlyBondingManager whenSystemNotPaused {
        livepeerToken().burn(_amount);
    }

    /*
     * @dev Withdraw ETH to a recipient
     * @param _to Recipient address
     * @param _amount Amount of ETH
     */
    function withdrawETH(address _to, uint256 _amount) external onlyBondingManagerOrJobsManager whenSystemNotPaused {
        _to.transfer(_amount);
    }

    /*
     * @dev Deposit ETH from the JobsManager
     */
    function depositETH() external payable onlyJobsManager whenSystemNotPaused returns (bool) {
        return true;
    }

    /*
     * @dev Set the reward token amounts for the round. Only callable by the RoundsManager
     */
    function setCurrentRewardTokens() external onlyRoundsManager whenSystemNotPaused {
        setInflation();

        currentMintableTokens = mintedTokensPerRound();
        currentMintedTokens = 0;

        SetCurrentRewardTokens(currentMintableTokens);
    }

    /*
     * @dev Set inflation based upon the current bonding rate
     */
    function setInflation() internal {
        uint256 currentBondingRate = 0;
        uint256 totalSupply = livepeerToken().totalSupply();

        if (totalSupply > 0) {
            uint256 totalBonded = bondingManager().getTotalBonded();
            currentBondingRate = MathUtils.percPoints(totalBonded, totalSupply);
        }

        if (currentBondingRate < targetBondingRate) {
            // Bonding rate is below the target - increase inflation
            inflation = inflation.add(inflationChange);
        } else if (currentBondingRate > targetBondingRate) {
            // Bonding rate is above the target - decrease inflation
            if (inflationChange > inflation) {
                inflation = 0;
            } else {
                inflation -= inflationChange;
            }
        }

        NewInflation(inflation);
    }

    /*
     * @dev Return minted tokens per round based current inflation and token supply
     */
    function mintedTokensPerRound() internal view returns (uint256) {
        uint256 currentSupply = livepeerToken().totalSupply();
        return MathUtils.percOf(currentSupply, inflation);
    }

    /*
     * @dev Returns LivepeerToken
     */
    function livepeerToken() internal view returns (ILivepeerToken) {
        return ILivepeerToken(controller.getContract(keccak256("LivepeerToken")));
    }

    /*
     * @dev Returns RoundsManager
     */
    function roundsManager() internal view returns (IRoundsManager) {
        return IRoundsManager(controller.getContract(keccak256("RoundsManager")));
    }

    /*
     * @dev Returns BondingManager
     */
    function bondingManager() internal view returns (IBondingManager) {
        return IBondingManager(controller.getContract(keccak256("BondingManager")));
    }
}
