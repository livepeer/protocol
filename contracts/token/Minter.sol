pragma solidity ^0.4.17;

import "../Manager.sol";
import "./IMinter.sol";
import "./ILivepeerToken.sol";
import "../rounds/IRoundsManager.sol";

import "zeppelin-solidity/contracts/math/SafeMath.sol";


contract Minter is Manager, IMinter {
    using SafeMath for uint256;

    // Token supply at the start of the protocol
    uint256 public initialTokenSupply;
    // Upper bound yearly inflation rate
    uint8 public yearlyInflation;
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

    function Minter(address _controller, uint256 _initialTokenSupply, uint8 _yearlyInflation) Manager(_controller) {
        initialTokenSupply = _initialTokenSupply;
        yearlyInflation = _yearlyInflation;
    }

    function setParameters(uint8 _yearlyInflation) external onlyAuthorized {
        yearlyInflation = _yearlyInflation;
    }

    /*
     * @dev Create reward based on a fractional portion of the mintable tokens and redistributable funds for a round
     * @param _fracNum Numerator of fraction (active transcoder's stake)
     * @param _fracDenom Denominator of fraction (total active stake)
     */
    function createReward(uint256 _fracNum, uint256 _fracDenom) external onlyAuthorized whenSystemNotPaused returns (uint256) {
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
    function transferTokens(address _to, uint256 _amount) external onlyAuthorized whenSystemNotPaused returns (bool) {
        return livepeerToken().transfer(_to, _amount);
    }

    /*
     * @dev Set the reward token amounts for the round. Only callable by the RoundsManager
     */
    function setCurrentRewardTokens() external whenSystemNotPaused returns (bool) {
        currentMintableTokens = mintedTokensPerRound();
        currentMintedTokens = 0;
        currentRedistributableTokens = redistributableTokensPerRound();
        currentRedistributedTokens = 0;

        return true;
    }

    /*
     * @dev Add funds to the redistribution pool
     * @param _amount Amount of funds to add to the redistribution pool
     */
    function addToRedistributionPool(uint256 _amount) external onlyAuthorized whenSystemNotPaused returns (bool) {
        redistributionPool = redistributionPool.add(_amount);

        return true;
    }

    /*
     * @dev Return minted tokens per round based on initial token supply, yearly inflation and number of rounds per year
     */
    function mintedTokensPerRound() internal view returns (uint256) {
        return initialTokenSupply.mul(yearlyInflation).div(100).div(roundsManager().roundsPerYear());
    }

    /*
     * @dev Return funds to be redistributed per round based on the total funds available for redistribution and the number of rounds per year
     */
    function redistributableTokensPerRound() internal view returns (uint256) {
        return redistributionPool.div(roundsManager().roundsPerYear());
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
}
