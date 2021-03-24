pragma solidity ^0.5.11;

import "../Manager.sol";
import "./IInflationManager.sol";
import "./IMinter.sol";
import "./ILivepeerToken.sol";
import "../rounds/IRoundsManager.sol";
import "../bonding/IBondingManager.sol";
import "../libraries/MathUtilsV2.sol";

import "openzeppelin-solidity/contracts/math/SafeMath.sol";


/**
 * @title InflationManager
 * @dev Manages inflation rate and the minting of new tokens for each round of the Livepeer protocol
 */
contract InflationManager is Manager, IInflationManager {
    using SafeMath for uint256;

    // Per round inflation rate
    uint256 public inflation;
    // Change in inflation rate per round until the target bonding rate is achieved
    uint256 public inflationChange;
    // Target bonding rate
    uint256 public targetBondingRate;

    // Current number of mintable tokens for the previous reward epoch, resets when a new reward epoch starts.
    uint256 public currentMintableTokens;
    // Current number of minted tokens for the previous reward epoch, resets when a new reward epoch starts.
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

    /**
     * @notice Minter constructor
     * @param _inflation Base inflation rate as a percentage of current total token supply
     * @param _inflationChange Change in inflation rate each round (increase or decrease) if target bonding rate is not achieved
     * @param _targetBondingRate Target bonding rate as a percentage of total bonded tokens / total token supply
     */
    constructor(address _controller, uint256 _inflation, uint256 _inflationChange, uint256 _targetBondingRate) public Manager(_controller) {
        // Inflation must be valid percentage
        require(MathUtils.validPerc(_inflation), "_inflation is invalid percentage");
        // Inflation change must be valid percentage
        require(MathUtils.validPerc(_inflationChange), "_inflationChange is invalid percentage");
        // Target bonding rate must be valid percentage
        require(MathUtils.validPerc(_targetBondingRate), "_targetBondingRate is invalid percentage");

        inflation = _inflation;
        inflationChange = _inflationChange;
        targetBondingRate = _targetBondingRate;
    }

    /**
     * @notice Set targetBondingRate. Only callable by Controller owner
     * @param _targetBondingRate Target bonding rate as a percentage of total bonded tokens / total token supply
     */
    function setTargetBondingRate(uint256 _targetBondingRate) external onlyControllerOwner {
        // Must be valid percentage
        require(MathUtils.validPerc(_targetBondingRate), "_targetBondingRate is invalid percentage");

        targetBondingRate = _targetBondingRate;

        emit ParameterUpdate("targetBondingRate");
    }

    /**
     * @notice Set inflationChange. Only callable by Controller owner
     * @param _inflationChange Inflation change as a percentage of total token supply
     */
    function setInflationChange(uint256 _inflationChange) external onlyControllerOwner {
        // Must be valid percentage
        require(MathUtils.validPerc(_inflationChange), "_inflationChange is invalid percentage");

        inflationChange = _inflationChange;

        emit ParameterUpdate("inflationChange");
    }

    /**
     * @notice Create reward based on a fractional portion of the mintable tokens for the current round
     * @param _fracNum Numerator of fraction (active transcoder's stake)
     * @param _fracDenom Denominator of fraction (total active stake)
     */
    function createReward(uint256 _fracNum, uint256 _fracDenom) external onlyBondingManager whenSystemNotPaused returns (uint256) {
        // Compute and mint fraction of mintable tokens to include in reward
        uint256 mintAmount = MathUtils.percOf(currentMintableTokens, _fracNum, _fracDenom);
        // Update amount of minted tokens for round
        currentMintedTokens = currentMintedTokens.add(mintAmount);
        // Minted tokens must not exceed mintable tokens
        require(currentMintedTokens <= currentMintableTokens, "minted tokens cannot exceed mintable tokens");
        // Mint new tokens
        minter().mintTokens(mintAmount);
        // Reward = minted tokens
        return mintAmount;
    }

    /**
     * @notice Set inflation and mintable tokens for the round. Only callable by the RoundsManager
     */
    function setCurrentRewardTokens() external onlyRoundsManager whenSystemNotPaused {
        setInflation();

        // Set mintable tokens based upon current inflation and current total token supply
        currentMintableTokens = MathUtils.percOf(livepeerToken().totalSupply(), inflation);
        currentMintedTokens = 0;

        emit SetCurrentRewardTokens(currentMintableTokens, inflation);
    }

    /**
     * @dev Set inflation based upon the current bonding rate and target bonding rate
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
                inflation = inflation.sub(inflationChange);
            }
        }
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

    /**
     * @dev Returns the InflationManager interface
     */
    function minter() internal view returns (IMinter) {
        return IMinter(controller.getContract(keccak256("InflationManager")));
    }

}
