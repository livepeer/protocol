pragma solidity ^0.4.17;

import "./token/ILivepeerToken.sol";

import "zeppelin-solidity/contracts/math/SafeMath.sol";
import "zeppelin-solidity/contracts/ownership/Ownable.sol";
import "zeppelin-solidity/contracts/token/TokenVesting.sol";
import "zeppelin-solidity/contracts/token/TokenTimelock.sol";


contract GenesisManager is Ownable {
    using SafeMath for uint256;

    // LivepeerToken contract
    ILivepeerToken public token;

    // Address of the token distribution contract
    address public tokenDistribution;
    // Address of the Livepeer bank multisig
    address public bankMultisig;
    // Address of the Minter contract in the Livepeer protocol
    address public minter;

    // Initial token supply issued
    uint256 public initialSupply;
    // Crowd's portion of the initial token supply
    uint256 public crowdSupply;
    // Company's portion of the initial token supply
    uint256 public companySupply;
    // Team's portion of the initial token supply
    uint256 public teamSupply;
    // Investors' portion of the initial token supply
    uint256 public investorsSupply;
    // Community's portion of the initial token supply
    uint256 public communitySupply;

    // Token amount in grants for the team
    uint256 public teamGrantsAmount;
    // Token amount in grants for investors
    uint256 public investorsGrantsAmount;
    // Token amount in grants for the community
    uint256 public communityGrantsAmount;

    // Timestamp at which vesting grants begin their vesting period
    // and timelock grants release locked tokens
    uint256 public grantsStartTimestamp;

    // Map receiver addresses => contracts holding receivers' vesting tokens
    mapping (address => address) public vestingHolders;
    // Map receiver addresses => contracts holding receivers' time locked tokens
    mapping (address => address) public timeLockedHolders;

    enum Stages {
        // Stage for setting the allocations of the initial token supply
        GenesisAllocation,
        // Stage for the creating token grants and the token distribution
        GenesisStart,
        // Stage for the end of genesis when ownership of the LivepeerToken contract
        // is transferred to the protocol Minter
        GenesisEnd
    }

    // Current stage of genesis
    Stages public stage;

    // Check if genesis is at a particular stage
    modifier atStage(Stages _stage) {
        require(stage == _stage);
        _;
    }

    /**
     * @dev GenesisManager constructor
     * @param _token Address of the Livepeer token contract
     * @param _tokenDistribution Address of the token distribution contract
     * @param _bankMultisig Address of the company bank multisig
     * @param _minter Address of the protocol Minter
     */
    function GenesisManager(
        address _token,
        address _tokenDistribution,
        address _bankMultisig,
        address _minter,
        uint256 _grantsStartTimestamp
    )
        public
    {
        token = ILivepeerToken(_token);
        tokenDistribution = _tokenDistribution;
        bankMultisig = _bankMultisig;
        minter = _minter;
        grantsStartTimestamp = _grantsStartTimestamp;

        stage = Stages.GenesisAllocation;
    }

    /**
     * @dev Set allocations for the initial token supply at genesis
     * @param _initialSupply Initial token supply at genesis
     * @param _crowdSupply Tokens allocated for the crowd at genesis
     * @param _companySupply Tokens allocated for the company (for future distribution) at genesis
     * @param _teamSupply Tokens allocated for the team at genesis
     * @param _investorsSupply Tokens allocated for investors at genesis
     * @param _communitySupply Tokens allocated for the community at genesis
     */
    function setAllocations(
        uint256 _initialSupply,
        uint256 _crowdSupply,
        uint256 _companySupply,
        uint256 _teamSupply,
        uint256 _investorsSupply,
        uint256 _communitySupply
    )
        external
        onlyOwner
        atStage(Stages.GenesisAllocation)
    {
        require(_crowdSupply.add(_companySupply).add(_teamSupply).add(_investorsSupply).add(_communitySupply) == _initialSupply);

        initialSupply = _initialSupply;
        crowdSupply = _crowdSupply;
        companySupply = _companySupply;
        teamSupply = _teamSupply;
        investorsSupply = _investorsSupply;
        communitySupply = _communitySupply;
    }

    /**
     * @dev Start genesis
     */
    function start() external onlyOwner atStage(Stages.GenesisAllocation) {
        // Mint the initial supply
        token.mint(this, initialSupply);

        stage = Stages.GenesisStart;
    }

    /**
     * @dev Add a team grant for tokens with a vesting schedule
     * @param _receiver Grant receiver
     * @param _amount Amount of tokens included in the grant
     * @param _timeToCliff Seconds until the vesting cliff
     * @param _vestingDuration Seconds starting from the vesting cliff until the end of the vesting schedule
     */
    function addTeamGrant(
        address _receiver,
        uint256 _amount,
        uint256 _timeToCliff,
        uint256 _vestingDuration
    )
        external
        onlyOwner
        atStage(Stages.GenesisStart)
    {
        uint256 updatedGrantsAmount = teamGrantsAmount.add(_amount);
        // Amount of tokens included in team grants cannot exceed the team supply during genesis
        require(updatedGrantsAmount <= teamSupply);

        teamGrantsAmount = updatedGrantsAmount;

        addVestingGrant(_receiver, _amount, _timeToCliff, _vestingDuration);
    }

    /**
     * @dev Add an investor grant for tokens with a vesting schedule
     * @param _receiver Grant receiver
     * @param _amount Amount of tokens included in the grant
     * @param _timeToCliff Seconds until the vesting cliff
     * @param _vestingDuration Seconds starting from the vesting cliff until the end of the vesting schedule
     */
    function addInvestorGrant(
        address _receiver,
        uint256 _amount,
        uint256 _timeToCliff,
        uint256 _vestingDuration
    )
        external
        onlyOwner
        atStage(Stages.GenesisStart)
    {
        uint256 updatedGrantsAmount = investorsGrantsAmount.add(_amount);
        // Amount of tokens included in investor grants cannot exceed the investor supply during genesis
        require(updatedGrantsAmount <= investorsSupply);

        investorsGrantsAmount = updatedGrantsAmount;

        addVestingGrant(_receiver, _amount, _timeToCliff, _vestingDuration);
    }

    /**
     * @dev Add a community grant for tokens that are locked until a predetermined time in the future
     * @param _receiver Grant receiver address
     * @param _amount Amount of tokens included in the grant
     */
    function addCommunityGrant(
        address _receiver,
        uint256 _amount
    )
        external
        onlyOwner
        atStage(Stages.GenesisStart)
    {
        uint256 updatedGrantsAmount = communityGrantsAmount.add(_amount);
        // Amount of tokens included in investor grants cannot exceed the community supply during genesis
        require(updatedGrantsAmount <= communitySupply);

        communityGrantsAmount = updatedGrantsAmount;

        // Receiver must not have already received a grant with timelocked tokens
        require(timeLockedHolders[_receiver] == address(0));

        // Create a timelocked holder contract to act as the holder of the grant's tokens
        TokenTimelock holder = new TokenTimelock(token, _receiver, grantsStartTimestamp);
        timeLockedHolders[_receiver] = holder;

        token.transfer(holder, _amount);
    }

    /**
     * @dev End genesis
     */
    function end() external onlyOwner atStage(Stages.GenesisStart) {
        // Transfer the crowd supply to the token distribution contract
        token.transfer(tokenDistribution, crowdSupply);
        // Transfer company supply to the bank multisig
        token.transfer(bankMultisig, companySupply);
        // Transfer ownership of the LivepeerToken contract to the protocol Minter
        token.transferOwnership(minter);

        stage = Stages.GenesisEnd;
    }

    /**
     * @dev Add a grant for tokens with a vesting schedule. An internal helper function used by addTeamGrant and addInvestorGrant
     * @param _receiver Grant receiver
     * @param _amount Amount of tokens included in the grant
     * @param _timeToCliff Seconds until the vesting cliff
     * @param _vestingDuration Seconds starting from the vesting cliff until the end of the vesting schedule
     */
    function addVestingGrant(
        address _receiver,
        uint256 _amount,
        uint256 _timeToCliff,
        uint256 _vestingDuration
    )
        internal
    {
        // Receiver must not have already received a grant with a vesting schedule
        require(vestingHolders[_receiver] == address(0));

        // Create a vesting holder contract to act as the holder of the grant's tokens
        // Note: the vesting grant is revokable
        TokenVesting holder = new TokenVesting(_receiver, grantsStartTimestamp, _timeToCliff, _vestingDuration, true);
        vestingHolders[_receiver] = holder;

        // Transfer ownership of the vesting holder to the bank multisig
        // giving the bank multisig the ability to revoke the grant
        holder.transferOwnership(bankMultisig);

        token.transfer(holder, _amount);
    }
}
