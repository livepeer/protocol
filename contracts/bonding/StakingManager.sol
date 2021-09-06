// SPDX-FileCopyrightText: 2021 Livepeer <nico@livepeer.org>
// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "../ManagerProxyTarget.sol";
import "../utils/MathUtils.sol";
import "./Delegations.sol";
import "../utils/SortedDoublyLL.sol";

import "../token/ILivepeerToken.sol";
import "../token/IMinter.sol";
import "../rounds/IRoundsManager.sol";
import "./IStakingManager.sol";

uint256 constant MAX_FUTURE_ROUND = 2**256 - 1;

contract StakingManager is ManagerProxyTarget, IStakingManager {
    using SortedDoublyLL for SortedDoublyLL.Data;
    using Delegations for Delegations.Pool;

    // The various states a orchestrator can be in
    enum OrchestratorStatus {
        NotRegistered,
        Registered,
        Active
    }

    struct Orchestrator {
        // Time-keeping
        uint256 activationRound; // Round in which the orchestrator became active - 0 if inactive
        uint256 deactivationRound;
        // Commission accounting
        uint256 rewardShare; // % of reward shared with delegations
        uint256 feeShare; // % of fees shared with delegations
        uint256 feeCommissions; // fees earned from commission (not shared with delegators)
        uint256 lastRewardRound;
        // Delegation Pool
        Delegations.Pool delegationPool;
    }

    // Represents an amount of tokens that are being undelegate
    struct UnstakingLock {
        address orchestrator;
        uint256 amount; // Amount of tokens being ustaked
        uint256 withdrawRound; // Round at which undelegation period is over and tokens can be withdrawn
    }

    // Time between unstaking and possible withdrawal in rounds
    uint64 public unstakingPeriod;

    mapping(address => Orchestrator) private orchestrators;
    mapping(uint256 => UnstakingLock) public unstakingLocks;
    uint256 private lastUnstakingLockID;

    // The total active stake (sum of the stake of active set members) for the current round
    uint256 public currentRoundTotalActiveStake;
    // The total active stake (sum of the stake of active set members) for the next round
    uint256 public nextRoundTotalActiveStake;

    // The orchestrator pool is used to keep track of the orchestrators that are eligible for activation.
    // The pool keeps track of the pending active set in round N and the start of round N + 1 orchestrators
    // in the pool are locked into the active set for round N + 1
    SortedDoublyLL.Data private orchestratorPoolV2;

    // Check if sender is TicketBroker
    modifier onlyTicketBroker() {
        _onlyTicketBroker();
        _;
    }

    // Check if sender is RoundsManager
    modifier onlyRoundsManager() {
        _onlyRoundsManager();
        _;
    }

    // Check if sender is Verifier
    modifier onlyVerifier() {
        _onlyVerifier();
        _;
    }

    // Check if current round is initialized
    modifier currentRoundInitialized() {
        _currentRoundInitialized();
        _;
    }

    modifier autoClaimFees(address _orchestrator, address _delegator) {
        _claimFees(_orchestrator, payable(_delegator));
        _;
    }

    /**
     * @notice StakingManager constructor. Only invokes constructor of base Manager contract with provided Controller address
     * @dev This constructor will not initialize any state variables besides `controller`. The following setter functions
     * should be used to initialize state variables post-deployment:
     * - setUnstakingPeriod()
     * - setNumActiveOrchestrators()
     * - setMaxEarningsClaimsRounds()
     * @param _controller Address of Controller that this contract will be registered with
     */
    constructor(address _controller) Manager(_controller) {}

    /**
     * PROTOCOL PARAMETERRS
     */

    /**
     * @notice Set undelegation period. Only callable by Controller owner
     * @param _unstakingPeriod Rounds between unstaking and possible withdrawal
     */
    function setUnstakingPeriod(uint64 _unstakingPeriod) external onlyControllerOwner {
        unstakingPeriod = _unstakingPeriod;

        emit ParameterUpdate("unstakingPeriod");
    }

    /**
     * @notice Set maximum number of active orchestrators. Only callable by Controller owner
     * @param _numActiveOrchestrators Number of active orchestrators
     */
    function setNumActiveOrchestrators(uint256 _numActiveOrchestrators) external onlyControllerOwner {
        orchestratorPoolV2.setMaxSize(_numActiveOrchestrators);

        emit ParameterUpdate("numActiveOrchestrators");
    }

    /**
     * STAKING & DELEGATION
     */

    /**
     * @notice Stake an _amount of LPT for the caller and registers the account as an Orchestrator.
     * @dev If the caller enters, or is already in the orchestrator pool, the caller can provide an optional hint for its insertion position in the
     * pool via the `_newPosPrev` and `_newPosNext` params. A linear search will be executed starting at the hint to find the correct position.
     * In the best case, the hint is the correct position so no search is executed. See SortedDoublyLL.sol details on list hints
     * @param _amount Amount of tokens to stake
     * @param _newPosPrev Address of previous orchestrator in pool if the caller enters or is in the pool
     * @param _newPosNext Address of next orchestrator in pool if the caller enters or is in the pool
     */
    function stake(
        uint256 _amount,
        address _newPosPrev,
        address _newPosNext
    ) external {
        _delegate(_amount, msg.sender, msg.sender, _newPosPrev, _newPosNext);
        emit Stake(msg.sender, _amount);
    }

    /**
     * @notice Stake an _amount of LPT on behalf of another account '_for'. It transfers custody of the staked LPT to '_for' and registers the account as an Orchestrator.
     * @dev If the caller enters, or is already in the orchestrator pool, the caller can provide an optional hint for its insertion position in the
     * pool via the `_newPosPrev` and `_newPosNext` params. A linear search will be executed starting at the hint to find the correct position.
     * In the best case, the hint is the correct position so no search is executed. See SortedDoublyLL.sol details on list hints
     * @param _amount Amount of tokens to stake
     * @param _newPosPrev Address of previous orchestrator in pool if the enters or is in the pool
     * @param _newPosNext Address of next orchestrator in pool if the caller enters or is in the pool
     */
    function stakeFor(
        uint256 _amount,
        address _for,
        address _newPosPrev,
        address _newPosNext
    ) external {
        _delegate(_amount, _for, _for, _newPosPrev, _newPosNext);
        emit Stake(_for, _amount);
    }

    /**
     * @notice Unstake an amount of LPT from the caller. If the caller fully unstakes it resigns its status as an Orchestrator.
     * @dev If the caller remains in the orchestrator pool, the caller can provide an optional hint for its insertion position in the
     * pool via the `_newPosPrev` and `_newPosNext` params. A linear search will be executed starting at the hint to find the correct position.
     * In the best case, the hint is the correct position so no search is executed. See SortedDoublyLL.sol details on list hints
     * @param _amount Amount of tokens to unstake
     * @param _newPosPrev Address of previous orchestrator in pool if the caller remains in the pool
     * @param _newPosNext Address of next orchestrator in pool if the caller remains in the pool
     */
    function unstake(
        uint256 _amount,
        address _newPosPrev,
        address _newPosNext
    ) external {
        _undelegate(_amount, msg.sender, msg.sender, _newPosPrev, _newPosNext);
        emit Unstake(msg.sender, _amount);
    }

    /**
     * @notice Restake LPT that was previously unstaked, but is still pending withdrawal, for the caller using an unstaking lock.
     * @dev If the caller is in the orchestrator pool, the caller can provide an optional hint for the delegate's insertion position in the
     * pool via the `_newPosPrev` and `_newPosNext` params. A linear search will be executed starting at the hint to find the correct position.
     * In the best case, the hint is the correct position so no search is executed. See SortedDoublyLL.sol details on list hints
     * @param _unstakingLockID ID of unstaking lock to restake with
     * @param _newPosPrev Address of previous orchestrator in pool if the caller enters or is in the pool
     * @param _newPosNext Address of next orchestrator in pool if the caller enters or is in the pool
     */
    function restake(
        uint256 _unstakingLockID,
        address _newPosPrev,
        address _newPosNext
    ) external {
        _redelegate(_unstakingLockID, msg.sender, _newPosPrev, _newPosNext);
    }

    /**
     * @notice Delegate an _amount of LPT for the caller to an Orchestrator to earn a share of its rewards and fees.
     * @dev If the Orchestrator being delegated to enters, or is already in the orchestrator pool, the caller can provide an optional hint for its insertion position in the
     * pool via the `_newPosPrev` and `_newPosNext` params. A linear search will be executed starting at the hint to find the correct position.
     * In the best case, the hint is the correct position so no search is executed. See SortedDoublyLL.sol details on list hints
     * @param _amount Amount of tokens to delegate
     * @param _newPosPrev Address of previous orchestrator in pool if the delegate enters, or is already in the pool
     * @param _newPosNext Address of next orchestrator in pool if the delegate enters, or is already in the pool
     */
    function delegate(
        uint256 _amount,
        address _orchestrator,
        address _newPosPrev,
        address _newPosNext
    ) external {
        require(_orchestrator != msg.sender, "CANNOT_SELF_DELEGATE");
        _delegate(_amount, _orchestrator, msg.sender, _newPosPrev, _newPosNext);
        emit Delegate(msg.sender, _orchestrator, _amount);
    }

    /**
     * @notice Delegate an _amount of LPT  for another account '_for' to an Orchestrator. This transfers the custody of the staked LPT to '_for' and makes the account eligible to earn a share of the Orchestrator's rewards and fees.
     * @dev If the Orchestrator being delegated to enters, or is already in the orchestrator pool, the caller can provide an optional hint for its insertion position in the
     * pool via the `_newPosPrev` and `_newPosNext` params. A linear search will be executed starting at the hint to find the correct position.
     * In the best case, the hint is the correct position so no search is executed. See SortedDoublyLL.sol details on list hints
     * @param _amount Amount of tokens to delegate
     * @param _newPosPrev Address of previous orchestrator in pool if the delegate enters, or is already  in the pool
     * @param _newPosNext Address of next orchestrator in pool if the delegate enters, or is already in the pool
     */
    function delegateFor(
        uint256 _amount,
        address _orchestrator,
        address _for,
        address _newPosPrev,
        address _newPosNext
    ) external {
        require(_orchestrator != _for, "CANNOT_SELF_DELEGATE");
        _delegate(_amount, _orchestrator, _for, _newPosPrev, _newPosNext);
        emit Delegate(_for, _orchestrator, _amount);
    }

    /**
     * @notice Partially or completely change a delegation from one Orchestrator to another. Only delegations whereby the existing orchestrator is not the caller can be changed.
     * @dev If the Orchestrator being delegated to enters, or is already in the orchestrator pool, the caller can provide an optional hint for its insertion position in the
     * pool via the `_newPosPrev` and `_newPosNext` params. A linear search will be executed starting at the hint to find the correct position.
     * In the best case, the hint is the correct position so no search is executed. See SortedDoublyLL.sol details on list hints
     * @param _amount Amount of tokens to change for the delegation
     * @param _oldOrchestrator Address of the Orchestrator to delegate LPT away from
     * @param _newOrchestrator Address of the Orchestrator to delegate LPT to
     * @param _oldOrchestratorNewPosPrev Address of the previous orchestrator in pool for '_oldOrchestrator' if it remains in the pool
     * @param _oldOrchestratorNewPosNext Address of the next orchestrator in pool for '_oldOrchestrator' if it remains in the pool
     * @param _newOrchestratorNewPosPrev Address of the previous orchestrator in the pool for '_newOrchestrator' if it enters or is in the pool
     * @param _newOrchestratorNewPosNext Address of the next orchestrator in the pool for '_newOrchestrator' if it enters or is in the pool
     */
    function changeDelegation(
        uint256 _amount,
        address _oldOrchestrator,
        address _newOrchestrator,
        address _oldOrchestratorNewPosPrev,
        address _oldOrchestratorNewPosNext,
        address _newOrchestratorNewPosPrev,
        address _newOrchestratorNewPosNext
    ) external {
        // If _oldOrchestrator == msg.sender , revert
        require(msg.sender != _oldOrchestrator, "CANNOT_CHANGE_DELEGATION_FOR_SELF");
        // cannot change zero amount
        require(_amount > 0, "ZERO_CHANGE_DELEGATION_AMOUNT");

        // 1. Subtract stake for oldOrchestrator
        Delegations.Pool storage oldPool = orchestrators[_oldOrchestrator].delegationPool;

        if (orchestratorPoolV2.contains(_oldOrchestrator)) {
            uint256 oldOrchestratorStake = oldPool.poolTotalStake();
            _decreaseOrchTotalStake(
                _oldOrchestrator,
                oldOrchestratorStake,
                _amount,
                _oldOrchestratorNewPosPrev,
                _oldOrchestratorNewPosNext
            );
        }

        oldPool.unstake(msg.sender, _amount);

        emit Undelegate(msg.sender, _oldOrchestrator, _amount);

        // cfr. undelegate
        // 2. Add stake to new orchestrator
        Delegations.Pool storage newPool = orchestrators[_newOrchestrator].delegationPool;
        newPool.stake(msg.sender, _amount);
        uint256 newOrchestratorStake = newPool.poolTotalStake();

        _increaseOrchTotalStake(
            _newOrchestrator,
            newOrchestratorStake,
            _amount,
            _newOrchestratorNewPosPrev,
            _newOrchestratorNewPosNext
        );

        emit Delegate(msg.sender, _newOrchestrator, _amount);
    }

    /**
     * @notice Undelegate an amount of LPT for the caller from the provided '_orchestrator'.
     * @dev If the Orchestrator being undelegated from remains in the orchestrator pool, the caller can provide an optional hint for its insertion position in the
     * pool via the `_newPosPrev` and `_newPosNext` params. A linear search will be executed starting at the hint to find the correct position.
     * In the best case, the hint is the correct position so no search is executed. See SortedDoublyLL.sol details on list hints
     * @param _amount Amount of tokens to undelegate
     * @param _newPosPrev Address of previous orchestrator in pool if '_orchestrator' remains in the pool
     * @param _newPosNext Address of next orchestrator in pool if '_orchestrator' remains in the pool
     */
    function undelegate(
        uint256 _amount,
        address _orchestrator,
        address _newPosPrev,
        address _newPosNext
    ) external {
        _undelegate(_amount, _orchestrator, msg.sender, _newPosPrev, _newPosNext);
        emit Undelegate(msg.sender, _orchestrator, _amount);
    }

    /**
     * @notice Redelegate LPT that was previously undelegated, but is still pending withdrawal, for the caller using an unstaking lock.
     * @dev If the orchestrator being redelegated to is in the orchestrator pool, the caller can provide an optional hint for the delegate's insertion position in the
     * pool via the `_newPosPrev` and `_newPosNext` params. A linear search will be executed starting at the hint to find the correct position.
     * In the best case, the hint is the correct position so no search is executed. See SortedDoublyLL.sol details on list hints
     * @param _unstakingLockID ID of unstaking lock to redelegate with
     * @param _newPosPrev Address of previous orchestrator in pool if the orchestrator being redelegated to enters or is in the pool
     * @param _newPosNext Address of next orchestrator in pool if the orchestrator being redelegated to enters or is in the pool
     */
    function redelegate(
        uint256 _unstakingLockID,
        address _newPosPrev,
        address _newPosNext
    ) external {
        _redelegate(_unstakingLockID, msg.sender, _newPosPrev, _newPosNext);
    }

    /**
     * @notice Withdraws tokens for an unstaking lock that has existed through an undelegation period
     * @param _unstakingLockId ID of unstaking lock to withdraw with
     */
    function withdrawStake(uint256 _unstakingLockId) external whenSystemNotPaused currentRoundInitialized {
        UnstakingLock storage lock = unstakingLocks[_unstakingLockId];

        require(isValidUnstakingLock(_unstakingLockId), "INVALID_UNSTAKING_LOCK_ID");
        require(
            lock.withdrawRound <= roundsManager().currentRound(),
            "withdraw round must be before or equal to the current round"
        );

        uint256 amount = lock.amount;
        uint256 withdrawRound = lock.withdrawRound;
        // Delete unstaking lock
        delete unstakingLocks[_unstakingLockId];

        // Tell Minter to transfer stake (LPT) to the delegator
        minter().trustedTransferTokens(msg.sender, amount);

        emit WithdrawStake(msg.sender, _unstakingLockId, amount, withdrawRound);
    }

    /**
     * @notice Withdraw fees for an address
     * @param _orchestrator Address of the orchestrator to claim fees from
     * @dev Calculates amount of fees to claim using `feesOf`
     * @dev Updates Delegation.feeCheckpoint for the address to the current total amount of fees in the delegation pool
     * @dev If the claimer is an orchestator, reset its commission
     * @dev Transfers funds
     */
    function withdrawFees(address _orchestrator) external whenSystemNotPaused currentRoundInitialized {
        _claimFees(_orchestrator, payable(msg.sender));
    }

    /**
     * ORCHESTRATOR ACTIONS
     */

    /**
     * @notice Sets commission rates as a orchestrator and if the caller is not in the orchestrator pool tries to add it
     * @dev Percentages are represented as numerators of fractions over MathUtils.PERC_DIVISOR
     * @dev caller can provide an optional hint for the insertion position in the pool via the `_newPosPrev` and `_newPosNext` params. A linear search will
        be executed starting at the hint to find the correct position - in the best case, the hint is the correct position so no search is executed.
        See SortedDoublyLL.sol for details on list hints
     * @param _rewardShare % of rewards paid to delegators by an orchestrator
     * @param _feeShare % of fees paid to delegators by a orchestrator
     * @param _newPosPrev Address of previous orchestrator in pool if the caller joins the pool
     * @param _newPosNext Address of next orchestrator in pool if the caller joins the pool
     */
    function orchestrator(
        uint256 _rewardShare,
        uint256 _feeShare,
        address _newPosPrev,
        address _newPosNext
    ) external whenSystemNotPaused currentRoundInitialized {
        require(!roundsManager().currentRoundLocked(), "CURRENT_ROUND_LOCKED");
        require(MathUtils.validPerc(_rewardShare), "REWARDSHARE_INVALID_PERC");
        require(MathUtils.validPerc(_feeShare), "FEESHARE_INVALID_PERC");
        require(isRegisteredOrchestrator(msg.sender), "ORCHESTRATOR_NOT_REGISTERED");

        Orchestrator storage o = orchestrators[msg.sender];
        uint256 currentRound = roundsManager().currentRound();

        require(!isActiveOrchestrator(msg.sender) || o.lastRewardRound == currentRound, "COMMISSION_RATES_LOCKED");

        o.rewardShare = _rewardShare;
        o.feeShare = _feeShare;

        if (!orchestratorPoolV2.contains(msg.sender)) {
            _tryToJoinActiveSet(
                msg.sender,
                o.delegationPool.poolTotalStake(),
                currentRound + 1,
                _newPosPrev,
                _newPosNext
            );
        }

        emit OrchestratorUpdate(msg.sender, _rewardShare, _feeShare);
    }

    /**
     * @notice Mint token rewards for an active orchestrator and its delegators and update the orchestrator pool using an optional list hint if needed
     * @dev If the caller is in the orchestrator pool, the caller can provide an optional hint for its insertion position in the
     * pool via the `_newPosPrev` and `_newPosNext` params. A linear search will be executed starting at the hint to find the correct position.
     * In the best case, the hint is the correct position so no search is executed. See SortedDoublyLL.sol for details on list hints
     * @param _newPosPrev Address of previous orchestrator in pool if the caller is in the pool
     * @param _newPosNext Address of next orchestrator in pool if the caller is in the pool
     */
    function reward(address _newPosPrev, address _newPosNext) public whenSystemNotPaused currentRoundInitialized {
        uint256 currentRound = roundsManager().currentRound();

        require(isActiveOrchestrator(msg.sender), "ORCHESTRATOR_NOT_ACTIVE");

        Orchestrator storage o = orchestrators[msg.sender];

        require(o.lastRewardRound != currentRound, "ALREADY_CALLED_REWARD_FOR_CURRENT_ROUND");

        // Create reward based on active orchestrator's stake relative to the total active stake
        // rewardTokens = (current mintable tokens for the round * active orchestrator stake) / total active stake
        uint256 totalStake = o.delegationPool.poolTotalStake();
        uint256 rewardTokens = minter().createReward(totalStake, currentRoundTotalActiveStake);

        _updateOrchestratorWithRewards(msg.sender, rewardTokens);
        _increaseOrchTotalStake(msg.sender, totalStake, rewardTokens, _newPosPrev, _newPosNext);

        // Set last round that orchestrator called reward
        o.lastRewardRound = currentRound;

        emit Reward(msg.sender, rewardTokens);
    }

    /**
     * EARNINGS ACCOUNTING
     */

    /**
     * @notice Updates orchestrator with fees from a redeemed winning ticket
     * @dev Calculates the orchestrator's fee commission based on its fee share and assigns it to the orchestrator
     * @dev Calculates the amount fees to assign to the delegation pool
        based on the fee amount and the orchestrator's fee share
     * @dev Adds the calculated amount to the delegation pool, updating DelegationPool.fees
     * @dev This in turn increases the amount of total fees in the delegation pool,
        increases the individual fees calculated from the nominal amount of shares held by a delegator
     * @dev Reverts if system is paused
     * @dev Reverts if caller is not TicketBroker
     */
    function updateOrchestratorWithFees(address _orchestrator, uint256 _fees)
        external
        override
        whenSystemNotPaused
        onlyTicketBroker
    {
        _updateOrchestratorWithFees(_orchestrator, _fees);
    }

    /**
     * @notice Called during round initialization to set the total active stake for the round.
     * @dev Only callable by the RoundsManager
     */
    function setCurrentRoundTotalActiveStake() external override onlyRoundsManager {
        currentRoundTotalActiveStake = nextRoundTotalActiveStake;
    }

    /**
     * GETTERS
     */

    /**
     * @notice Return whether an unstaking lock for a delegator is valid
     * @param _unstakingLockId ID of unstaking lock
     * @return true if unstakingLock for ID has a non-zero withdraw round
     */
    function isValidUnstakingLock(uint256 _unstakingLockId) public view returns (bool) {
        // A unstaking lock is only valid if it has a non-zero withdraw round (the default value is zero)
        return unstakingLocks[_unstakingLockId].withdrawRound > 0;
    }

    function getDelegation(address _orchestrator, address _delegator)
        public
        view
        returns (uint256 stake, uint256 fees)
    {
        (stake, fees) = orchestrators[_orchestrator].delegationPool.stakeAndFeesOf(_delegator);
    }

    /**
     * @notice Calculate the total stake for an address
     * @dev Calculates the amount of tokens represented by the address' share of the delegation pool
     * @dev If the address is an orchestrator, add its commission
     * @dev Delegators don't need support fetching on-chain stake directly,
        so for multi-delegation we can do calculations off chain
        and repurpose this to 'orchestratorStake(address _orchestrator)'
     */
    function getDelegatedStake(address _orchestrator, address _delegator) public view returns (uint256 delegatedStake) {
        Orchestrator storage orch = orchestrators[_orchestrator];
        delegatedStake = orch.delegationPool.stakeOf(_delegator);
    }

    /**
     * @notice Calculate the withdrawable fees for an address
     * @dev Calculates the amount of ETH fees represented by the address'
        share of the delegation pool and its last fee checkpoint
     * @dev If the address is an orchestrator, add its commission
     * @dev NOTE: currently doesn't support multi-delegation
     * @dev Delegators don't need support fetching on-chain fees directly,
        so for multi-delegation we can do calculations off chain
        and repurpose this to 'orchestratorFees(address _orchestrator)'
     */
    function feesOf(address _orchestrator, address _delegator) public view returns (uint256 fees) {
        Orchestrator storage orch = orchestrators[_orchestrator];
        fees = orch.delegationPool.feesOf(_delegator);
        if (_orchestrator == _delegator) {
            fees += orch.feeCommissions;
        }
    }

    /**
     * @notice Returns total stake for a orchestrator
     * @param _orchestrator Address of orchestrator
     * @return total stake for an orchestrator
     */
    function orchestratorTotalStake(address _orchestrator) public view returns (uint256) {
        return orchestrators[_orchestrator].delegationPool.poolTotalStake();
    }

    /**
     * @notice Return whether a orchestrator is registered
     * @param _orchestrator orchestrator address
     * @return true if orchestrator is self-delegated
     */
    function isRegisteredOrchestrator(address _orchestrator) public view returns (bool) {
        return orchestrators[_orchestrator].delegationPool.stakeOf(_orchestrator) > 0;
    }

    /**
     * @notice Return whether a orchestrator is active for the current round
     * @param _orchestrator orchestrator address
     * @return true if orchestrator is active
     */
    function isActiveOrchestrator(address _orchestrator) public view override returns (bool) {
        Orchestrator storage o = orchestrators[_orchestrator];
        uint256 currentRound = roundsManager().currentRound();
        return o.activationRound <= currentRound && currentRound < o.deactivationRound;
    }

    /**
     * @notice Computes orchestrator status
     * @param _orchestrator Address of orchestrator
     * @return active, registered or not registered orchestrator status
     */
    function orchestratorStatus(address _orchestrator) public view returns (OrchestratorStatus) {
        if (isActiveOrchestrator(_orchestrator)) return OrchestratorStatus.Active;
        if (isRegisteredOrchestrator(_orchestrator)) return OrchestratorStatus.Registered;
        return OrchestratorStatus.NotRegistered;
    }

    /**
     * @notice Returns max size of orchestrator pool
     * @return orchestrator pool max size
     */
    function getOrchestratorPoolMaxSize() public view returns (uint256) {
        return orchestratorPoolV2.getMaxSize();
    }

    /**
     * @notice Returns size of orchestrator pool
     * @return orchestrator pool current size
     */
    function getOrchestratorPoolSize() public view override returns (uint256) {
        return orchestratorPoolV2.getSize();
    }

    /**
     * @notice Returns orchestrator with most stake in pool
     * @return address for orchestrator with highest stake in orchestrator pool
     */
    function getFirstOrchestratorInPool() public view returns (address) {
        return orchestratorPoolV2.getFirst();
    }

    /**
     * @notice Returns next orchestrator in pool for a given orchestrator
     * @param _orchestrator Address of a orchestrator in the pool
     * @return address for the orchestrator after '_orchestrator' in orchestrator pool
     */
    function getNextOrchestratorInPool(address _orchestrator) public view returns (address) {
        return orchestratorPoolV2.getNext(_orchestrator);
    }

    /**
     * @notice Return total staked tokens
     * @return total active stake for the current round
     */
    function getTotalStaked() public view override returns (uint256) {
        return currentRoundTotalActiveStake;
    }

    /**
     * @notice Delegate stake towards a specific address and updates the orchestrator pool using optional list hints if needed
     * @dev If the caller is decreasing the stake of its old delegate in the orchestrator pool, the caller can provide an optional hint
     * for the insertion position of the old delegate via the `_oldDelegateNewPosPrev` and `_oldDelegateNewPosNext` params.
     * If the caller is delegating to a delegate that is in the orchestrator pool, the caller can provide an optional hint for the
     * insertion position of the delegate via the `_newPosPrev` and `_newPosNext` params.
     * In both cases, a linear search will be executed starting at the hint to find the correct position. In the best case, the hint
     * is the correct position so no search is executed. See SortedDoublyLL.sol for details on list hints
     * @param _amount The amount of tokens to stake.
     * @param _orchestrator The address of the orchestrator to stake towards
     * @param _for The address which will own the stake
     * @param _newPosPrev The address of the previous orchestrator in the pool for the current delegate
     * @param _newPosNext The address of the next orchestrator in the pool for the current delegate
     */
    function _delegate(
        uint256 _amount,
        address _orchestrator,
        address _for,
        address _newPosPrev,
        address _newPosNext
    ) internal whenSystemNotPaused currentRoundInitialized autoClaimFees(_orchestrator, _for) {
        // cannot delegate zero amount
        require(_amount > 0, "ZERO_DELEGATION_AMOUNT");

        // Delegate stake to _orchestrator for account "_for"
        Delegations.Pool storage _pool = orchestrators[_orchestrator].delegationPool;
        uint256 oldTotalStake = _pool.poolTotalStake();
        _pool.stake(_for, _amount);

        _increaseOrchTotalStake(_orchestrator, oldTotalStake, _amount, _newPosPrev, _newPosNext);

        // Transfer the LPT to the Minter
        livepeerToken().transferFrom(_for, address(minter()), _amount);
    }

    function _undelegate(
        uint256 _amount,
        address _orchestrator,
        address _for,
        address _newPosPrev,
        address _newPosNext
    ) internal whenSystemNotPaused currentRoundInitialized autoClaimFees(_orchestrator, _for) {
        require(_amount > 0, "ZERO_UNSTAKE_AMOUNT");

        uint256 orchStake = orchestratorTotalStake(_orchestrator);
        uint256 delegatorStake = getDelegatedStake(_orchestrator, _for);

        require(delegatorStake > 0, "CALLER_NOT_STAKED");
        require(_amount <= delegatorStake, "AMOUNT_EXCEEDS_STAKE");

        // If the orchestrator is in the orchestrator pool, update the pool
        if (orchestratorPoolV2.contains(_orchestrator)) {
            // If the caller is the orchestrator itself and the amount to undelegate
            // equals the self-staked amount, resign the orchestrator
            if (_orchestrator == _for && _amount == delegatorStake) {
                _resignOrchestrator(_orchestrator);
            } else {
                // Otherwise decrease the orchestrator's stake and update its position in the orchestrator pool
                _decreaseOrchTotalStake(_orchestrator, orchStake, _amount, _newPosPrev, _newPosNext);
            }
        }

        Delegations.Pool storage pool = orchestrators[_orchestrator].delegationPool;
        pool.unstake(_for, _amount);

        // Create unstaking lock for _amount
        uint256 id = lastUnstakingLockID;
        lastUnstakingLockID++;

        uint256 currentRound = roundsManager().currentRound();

        unstakingLocks[id] = UnstakingLock({
            orchestrator: _orchestrator,
            amount: _amount,
            withdrawRound: currentRound + unstakingPeriod
        });
    }

    function _redelegate(
        uint256 _unstakingLockID,
        address _for,
        address _newPosPrev,
        address _newPosNext
    ) internal whenSystemNotPaused currentRoundInitialized {
        UnstakingLock storage lock = unstakingLocks[_unstakingLockID];

        require(isValidUnstakingLock(_unstakingLockID), "INVALID_UNSTAKING_LOCK_ID");

        address orchestrator = lock.orchestrator;
        uint256 amount = lock.amount;

        // Claim outstanding fees and checkpoint fee factor
        _claimFees(orchestrator, payable(_for));

        uint256 oldStake = orchestratorTotalStake(orchestrator);

        // Increase delegator's staked amount
        orchestrators[orchestrator].delegationPool.stake(_for, amount);

        // Delete lock
        delete unstakingLocks[_unstakingLockID];

        _increaseOrchTotalStake(orchestrator, oldStake, amount, _newPosPrev, _newPosNext);

        if (_for == orchestrator) {
            emit Stake(orchestrator, amount);
        } else {
            emit Delegate(_for, orchestrator, amount);
        }
    }

    function _updateOrchestratorWithFees(address _orchestrator, uint256 _fees) internal {
        Orchestrator storage orch = orchestrators[_orchestrator];

        uint256 feeShare = MathUtils.percOf(_fees, orch.feeShare);

        orch.feeCommissions = _fees - feeShare;
        orch.delegationPool.addFees(feeShare);
    }

    /**
     * @notice Updates orchestrator with assigned rewards
     * @dev Calculates the orchestrator's reward commission based on its reward share and assigns it to the orchestrator
     * @dev Calculates the amount of tokens to assign to the delegation pool 
        based on the reward amount and the orchestrator's reward share
     * @dev Adds the calculated amount to the delegation pool, updating delegationPool.poolTotalStake
     * @dev This in turn increases the amount of LPT represented by a nominal share amount held by delegators
     */
    function _updateOrchestratorWithRewards(address _orchestrator, uint256 _rewards) internal {
        Orchestrator storage orch = orchestrators[_orchestrator];

        uint256 rewardShare = MathUtils.percOf(_rewards, orch.rewardShare);

        uint256 rewardCut = _rewards - rewardShare;
        orch.delegationPool.stake(_orchestrator, rewardCut);
        orch.delegationPool.addRewards(rewardShare);
    }

    function _increaseOrchTotalStake(
        address _orchestrator,
        uint256 _oldStake,
        uint256 _increase,
        address _newPosPrev,
        address _newPosNext
    ) internal {
        uint256 newStake = _oldStake + _increase;
        if (orchestratorPoolV2.contains(_orchestrator)) {
            orchestratorPoolV2.updateKey(_orchestrator, newStake, _newPosPrev, _newPosNext);
            nextRoundTotalActiveStake += _increase;
        } else {
            _tryToJoinActiveSet(_orchestrator, newStake, roundsManager().currentRound() + 1, _newPosPrev, _newPosNext);
        }
    }

    function _decreaseOrchTotalStake(
        address _orchestrator,
        uint256 _oldStake,
        uint256 _decrease,
        address _newPosPrev,
        address _newPosNext
    ) internal {
        if (!orchestratorPoolV2.contains(_orchestrator)) {
            return;
        }

        uint256 newStake = _oldStake - _decrease;
        orchestratorPoolV2.updateKey(_orchestrator, newStake, _newPosPrev, _newPosNext);
        nextRoundTotalActiveStake -= _decrease;
    }

    /**
     * @dev Remove a orchestrator from the pool and deactivate it
     */
    function _resignOrchestrator(address _orchestrator) internal {
        // Not zeroing 'Orchestrator.lastActiveStakeUpdateRound' saves gas (5k when orchestrator is evicted and 20k when orchestrator is reinserted)
        // There should be no side-effects as long as the value is properly updated on stake updates
        // Not zeroing the stake on the current round's 'EarningsPool' saves gas and should have no side effects as long as
        // 'EarningsPool.setStake()' is called whenever a orchestrator becomes active again.
        orchestratorPoolV2.remove(_orchestrator);
        nextRoundTotalActiveStake -= orchestratorTotalStake(_orchestrator);
        uint256 deactivationRound = roundsManager().currentRound() + 1;
        orchestrators[_orchestrator].deactivationRound = deactivationRound;
        emit OrchestratorDeactivated(_orchestrator, deactivationRound);
    }

    /**
     * @dev Tries to add a orchestrator to active orchestrator pool, evicts the active orchestrator with the lowest stake if the pool is full
     * @param _orchestrator The orchestrator to insert into the orchestrator pool
     * @param _totalStake The total stake for '_orchestrator'
     * @param _activationRound The round in which the orchestrator should become active
     */
    function _tryToJoinActiveSet(
        address _orchestrator,
        uint256 _totalStake,
        uint256 _activationRound,
        address _newPosPrev,
        address _newPosNext
    ) internal {
        uint256 pendingNextRoundTotalActiveStake = nextRoundTotalActiveStake;

        if (orchestratorPoolV2.isFull()) {
            address lastOrchestrator = orchestratorPoolV2.getLast();
            uint256 lastStake = orchestrators[lastOrchestrator].delegationPool.poolTotalStake();

            // If the pool is full and the orchestrator has less stake than the least stake orchestrator in the pool
            // then the orchestrator is unable to join the active set for the next round
            if (_totalStake <= lastStake) {
                return;
            }

            // Evict the least stake orchestrator from the active set for the next round
            // Not zeroing 'Orchestrator.lastActiveStakeUpdateRound' saves gas (5k when orchestrator is evicted and 20k when orchestrator is reinserted)
            // There should be no side-effects as long as the value is properly updated on stake updates
            // Not zeroing the stake on the current round's 'EarningsPool' saves gas and should have no side effects as long as
            // 'EarningsPool.setStake()' is called whenever a orchestrator becomes active again.
            orchestratorPoolV2.remove(lastOrchestrator);
            orchestrators[lastOrchestrator].deactivationRound = _activationRound;
            pendingNextRoundTotalActiveStake = pendingNextRoundTotalActiveStake - lastStake;

            emit OrchestratorDeactivated(lastOrchestrator, _activationRound);
        }

        orchestratorPoolV2.insert(_orchestrator, _totalStake, _newPosPrev, _newPosNext);
        pendingNextRoundTotalActiveStake = pendingNextRoundTotalActiveStake + _totalStake;
        Orchestrator storage o = orchestrators[_orchestrator];
        o.activationRound = _activationRound;
        o.deactivationRound = MAX_FUTURE_ROUND;
        nextRoundTotalActiveStake = pendingNextRoundTotalActiveStake;
        emit OrchestratorActivated(_orchestrator, _activationRound);
    }

    /**
     * @notice Withdraw fees for an address
     * @dev Calculates amount of fees to claim using `feesOf`
     * @dev Updates Delegation.feeCheckpoint for the address to the current total amount of fees in the delegation pool
     * @dev If the claimer is an orchestator, reset its commission
     * @dev Transfer funds
     * @dev NOTE: currently doesn't support multi-delegation, would have to add an orchestrator address param
     */
    function _claimFees(address _orchestrator, address payable _for) internal {
        Orchestrator storage orch = orchestrators[_orchestrator];
        uint256 fees = orch.delegationPool.claimFees(_for);
        if (_for == _orchestrator) {
            fees += orch.feeCommissions;
            orch.feeCommissions = 0;
        }
        minter().trustedWithdrawETH(_for, fees);
    }

    /**
     * @dev Return LivepeerToken interface
     * @return Livepeer token contract registered with Controller
     */
    function livepeerToken() internal view returns (ILivepeerToken) {
        return ILivepeerToken(controller.getContract(keccak256("LivepeerToken")));
    }

    /**
     * @dev Return Minter interface
     * @return Minter contract registered with Controller
     */
    function minter() internal view returns (IMinter) {
        return IMinter(controller.getContract(keccak256("Minter")));
    }

    /**
     * @dev Return RoundsManager interface
     * @return RoundsManager contract registered with Controller
     */
    function roundsManager() internal view returns (IRoundsManager) {
        return IRoundsManager(controller.getContract(keccak256("RoundsManager")));
    }

    function _onlyTicketBroker() internal view {
        require(msg.sender == controller.getContract(keccak256("TicketBroker")), "ONLY_TICKETBROKER");
    }

    function _onlyRoundsManager() internal view {
        require(msg.sender == controller.getContract(keccak256("RoundsManager")), "ONLY_ROUNDSMANAGER");
    }

    function _onlyVerifier() internal view {
        require(msg.sender == controller.getContract(keccak256("Verifier")), "ONLY_VERIFIER");
    }

    function _currentRoundInitialized() internal view {
        require(roundsManager().currentRoundInitialized(), "CURRENT_ROUND_NOT_INITIALIZED");
    }
}
