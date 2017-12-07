pragma solidity ^0.4.17;

import "../Manager.sol";
import "./IMinter.sol";
import "./ILivepeerToken.sol";
import "../rounds/IRoundsManager.sol";
import "../bonding/IBondingManager.sol";

import "zeppelin-solidity/contracts/math/SafeMath.sol";


contract Minter is Manager, IMinter {
    using SafeMath for uint256;

    // Per round inflation rate
    uint256 public inflation;
    // Change in inflation rate per round until the target bonding rate is achieved
    uint256 public inflationChange;
    // Target bonding rate
    uint256 public targetBondingRate;

    // Tokens that are redistributed as a part of rewards
    uint256 public redistributionPool;
    // Current number of mintable tokens. Reset every round
    uint256 public currentMintableTokens;
    // Current number of minted tokens. Reset every round
    uint256 public currentMintedTokens;
    // Current number of redistributable tokens. Reset every round
    uint256 public currentRedistributableTokens;
    // Current number of redistributed tokens. Reset every round
    uint256 public currentRedistributedTokens;

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
        require(_inflation <= PERC_DIVISOR);
        // Inflation change must be valid percentage
        require(_inflationChange <= PERC_DIVISOR);
        // Target bonding rate must be valid percentage
        require(_targetBondingRate <= PERC_DIVISOR);

        inflation = _inflation;
        inflationChange = _inflationChange;
        targetBondingRate = _targetBondingRate;
    }

    function setTargetBondingRate(uint256 _targetBondingRate) external onlyControllerOwner {
        // Must be valid percentage
        require(_targetBondingRate <= PERC_DIVISOR);

        targetBondingRate = _targetBondingRate;

        ParameterUpdate("targetBondingRate");
    }

    /*
     * @dev Create reward based on a fractional portion of the mintable tokens and redistributable funds for a round
     * @param _fracNum Numerator of fraction (active transcoder's stake)
     * @param _fracDenom Denominator of fraction (total active stake)
     */
    function createReward(uint256 _fracNum, uint256 _fracDenom) external onlyBondingManager whenSystemNotPaused returns (uint256) {
        // Compute fraction of redistributable tokens to include in reward
        uint256 redistributeAmount = currentRedistributableTokens.mul(_fracNum).div(_fracDenom);
        // Update amount of redistributed tokens for round
        currentRedistributedTokens = currentRedistributedTokens.add(redistributeAmount);
        redistributionPool = redistributionPool.sub(redistributeAmount);
        // Redistributed tokens must not exceed redistributable tokens
        require(currentRedistributedTokens <= currentRedistributableTokens);

        // Compute and mint fraction of mintable tokens to include in reward
        uint256 mintAmount = currentMintableTokens.mul(_fracNum).div(_fracDenom);
        // Update amount of minted tokens for round
        currentMintedTokens = currentMintedTokens.add(mintAmount);
        // Minted tokens must not exceed mintable tokens
        require(currentMintedTokens <= currentMintableTokens);
        // Mint new tokens
        livepeerToken().mint(this, mintAmount);

        // Reward = minted tokens + redistributed tokens
        return mintAmount.add(redistributeAmount);
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
     * @dev Set the reward token amounts for the round. Only callable by the RoundsManager
     */
    function setCurrentRewardTokens() external onlyRoundsManager whenSystemNotPaused {
        setInflation();

        currentMintableTokens = mintedTokensPerRound();
        currentMintedTokens = 0;
        currentRedistributableTokens = redistributableTokensPerRound();
        currentRedistributedTokens = 0;

        SetCurrentRewardTokens(currentMintableTokens, currentRedistributableTokens, roundsManager().currentRound());
    }

    /*
     * @dev Set inflation based upon the current bonding rate
     */
    function setInflation() internal {
        uint256 currentBondingRate = (bondingManager().getTotalBonded() * PERC_DIVISOR) / livepeerToken().totalSupply();

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

        NewInflation(inflation, roundsManager().currentRound());
    }

    /*
     * @dev Add funds to the redistribution pool
     * @param _amount Amount of funds to add to the redistribution pool
     */
    function addToRedistributionPool(uint256 _amount) external onlyBondingManager whenSystemNotPaused {
        redistributionPool = redistributionPool.add(_amount);
    }

    /*
     * @dev Return minted tokens per round based current inflation and token supply
     */
    function mintedTokensPerRound() internal view returns (uint256) {
        uint256 currentSupply = livepeerToken().totalSupply();
        return currentSupply.mul(inflation).div(PERC_DIVISOR);
    }

    /*
     * @dev Return redistributable tokens per round
     */
    function redistributableTokensPerRound() internal view returns (uint256) {
        return redistributionPool.div(100);
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
