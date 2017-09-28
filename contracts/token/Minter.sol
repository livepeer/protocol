pragma solidity ^0.4.13;

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

    // Sender must be BondingManager
    modifier onlyBondingManager() {
        require(msg.sender == controller.getContract(keccak256("BondingManager")));
        _;
    }

    // Sender must be BondingManager or JobsManager
    modifier onlyBondingManagerOrJobsManager() {
        require(msg.sender == controller.getContract(keccak256("BondingManager")) || msg.sender == controller.getContract(keccak256("JobsManager")));
        _;
    }

    function Minter(address _controller, uint256 _initialTokenSupply, uint8 _yearlyInflation) Manager(_controller) {
        initialTokenSupply = _initialTokenSupply;
        yearlyInflation = _yearlyInflation;
    }

    /*
     * @dev Mint new tokens based on the active stake proportional to the total active stake
     * @param _activeStake Stake of active transcoder
     * @param _totalActiveStake Total stake of all active transcoders
     */
    function mint(uint256 _activeStake, uint256 _totalActiveStake) external onlyBondingManager returns (uint256) {
        uint256 amount = mintedTokensPerRound().mul(_activeStake).div(_totalActiveStake);
        livepeerToken().mint(this, amount);

        return amount;
    }

    /*
     * @dev Transfer tokens to a receipient
     * @param _to Recipient address
     * @param _amount Amount of tokens
     */
    function transferTokens(address _to, uint256 _amount) external onlyBondingManagerOrJobsManager returns (bool) {
        return livepeerToken().transfer(_to, _amount);
    }

    /*
     * @dev Set yearly inflation
     * @param _yearlyInflation Upper bound yearly inflation rate
     */
    function setYearlyInflation(uint8 _yearlyInflation) external onlyController returns (bool) {
        yearlyInflation = _yearlyInflation;

        return true;
    }

    /*
     * @dev Return minted tokens per round based on initial token supply, yearly inflation and number of rounds per year
     */
    function mintedTokensPerRound() internal constant returns (uint256) {
        return initialTokenSupply.mul(yearlyInflation).div(100).div(roundsManager().roundsPerYear());
    }

    /*
     * @dev Returns LivepeerToken
     */
    function livepeerToken() internal constant returns (ILivepeerToken) {
        return ILivepeerToken(controller.getContract(keccak256("LivepeerToken")));
    }

    /*
     * @dev Returns RoundsManager
     */
    function roundsManager() internal constant returns (IRoundsManager) {
        return IRoundsManager(controller.getContract(keccak256("RoundsManager")));
    }
}
