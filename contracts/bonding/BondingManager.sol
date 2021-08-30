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
import "./IBondingManager.sol";

uint256 constant MAX_FUTURE_ROUND = 2**256 - 1;

contract BondingManager is ManagerProxyTarget, IBondingManager {
    using SortedDoublyLL for SortedDoublyLL.Data;
    using Delegations for Delegations.Pool;

    // The various states a transcoder can be in
    enum OrchestratorStatus {
        NotRegistered,
        Registered,
        Active
    }

    struct Orchestrator {
        // Time-keeping
        uint256 activationRound; // Round in which the transcoder became active - 0 if inactive
        uint256 deactivationRound;
        // Commission accounting
        uint256 rewardShare; // % of reward shared with delegations
        uint256 feeShare; // % of fees shared with delegations
        uint256 rewardCommissions; // reward earned from commission (not shared with delegators)
        uint256 feeCommissions; // fees earned from commission (not shared with delegators)
        uint256 lastRewardRound;
        // Delegation Pool
        Delegations.Pool delegationPool;
    }

    // Represents an amount of tokens that are being unbonded
    struct UnbondingLock {
        address orchestrator;
        uint256 amount; // Amount of tokens being unbonded
        uint256 withdrawRound; // Round at which unbonding period is over and tokens can be withdrawn
    }

    // Time between unbonding and possible withdrawl in rounds
    uint64 public unbondingPeriod;

    mapping(address => Orchestrator) private orchestrators;
    mapping(uint256 => UnbondingLock) public unbondingLocks;
    uint256 private lastUnbondingLockID;

    // The total active stake (sum of the stake of active set members) for the current round
    uint256 public currentRoundTotalActiveStake;
    // The total active stake (sum of the stake of active set members) for the next round
    uint256 public nextRoundTotalActiveStake;

    // The transcoder pool is used to keep track of the transcoders that are eligible for activation.
    // The pool keeps track of the pending active set in round N and the start of round N + 1 transcoders
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

    modifier autoClaimFees(address _delegate) {
        _claimFees(_delegate, payable(msg.sender));
        _;
    }

    /**
     * @notice BondingManager constructor. Only invokes constructor of base Manager contract with provided Controller address
     * @dev This constructor will not initialize any state variables besides `controller`. The following setter functions
     * should be used to initialize state variables post-deployment:
     * - setUnbondingPeriod()
     * - setNumActiveTranscoders()
     * - setMaxEarningsClaimsRounds()
     * @param _controller Address of Controller that this contract will be registered with
     */
    constructor(address _controller) Manager(_controller) {}

    /**
     * PROTOCOL PARAMETERRS
     */
    /**
     * @notice Set unbonding period. Only callable by Controller owner
     * @param _unbondingPeriod Rounds between unbonding and possible withdrawal
     */
    function setUnbondingPeriod(uint64 _unbondingPeriod) external onlyControllerOwner {
        unbondingPeriod = _unbondingPeriod;

        emit ParameterUpdate("unbondingPeriod");
    }

    /**
     * @notice Set maximum number of active transcoders. Only callable by Controller owner
     * @param _numActiveTranscoders Number of active transcoders
     */
    function setNumActiveTranscoders(uint256 _numActiveTranscoders) external onlyControllerOwner {
        orchestratorPoolV2.setMaxSize(_numActiveTranscoders);

        emit ParameterUpdate("numActiveTranscoders");
    }

    /**
     * STAKING & DELEGATION ACTIONS
     */

    /**
     * @notice Delegate stake towards a specific address
     * @param _amount The amount of tokens to stake
     * @param _orchestrator The address of the transcoder to stake towards
     * @param _oldDelegateNewPosPrev The address of the previous transcoder in the pool for the old delegate
     * @param _oldDelegateNewPosNext The address of the next transcoder in the pool for the old delegate
     * @param _currDelegateNewPosPrev The address of the previous transcoder in the pool for the current delegate
     * @param _currDelegateNewPosNext The address of the next transcoder in the pool for the current delegate
     */
    function bond(
        uint256 _amount,
        address _orchestrator,
        address _oldDelegateNewPosPrev,
        address _oldDelegateNewPosNext,
        address _currDelegateNewPosPrev,
        address _currDelegateNewPosNext
    ) external {
        bond(
            _amount,
            _orchestrator,
            msg.sender,
            _oldDelegateNewPosPrev,
            _oldDelegateNewPosNext,
            _currDelegateNewPosPrev,
            _currDelegateNewPosNext
        );
    }

    /**
     * @notice Delegate stake towards a specific address on behalf of another address
     * @param _amount The amount of tokens to stake
     * @param _orchestrator The address of the transcoder to stake towards
     * @param _for The address which will own the stake
     * @param _oldDelegateNewPosPrev The address of the previous transcoder in the pool for the old delegate
     * @param _oldDelegateNewPosNext The address of the next transcoder in the pool for the old delegate
     * @param _currDelegateNewPosPrev The address of the previous transcoder in the pool for the current delegate
     * @param _currDelegateNewPosNext The address of the next transcoder in the pool for the current delegate
     */
    function bondFor(
        uint256 _amount,
        address _orchestrator,
        address _for,
        address _oldDelegateNewPosPrev,
        address _oldDelegateNewPosNext,
        address _currDelegateNewPosPrev,
        address _currDelegateNewPosNext
    ) external {
        bond(
            _amount,
            _orchestrator,
            _for,
            _oldDelegateNewPosPrev,
            _oldDelegateNewPosNext,
            _currDelegateNewPosPrev,
            _currDelegateNewPosNext
        );
    }

    /**
     * @notice Delegate stake towards a specific address and updates the transcoder pool using optional list hints if needed
     * @dev If the caller is decreasing the stake of its old delegate in the transcoder pool, the caller can provide an optional hint
     * for the insertion position of the old delegate via the `_oldDelegateNewPosPrev` and `_oldDelegateNewPosNext` params.
     * If the caller is delegating to a delegate that is in the transcoder pool, the caller can provide an optional hint for the
     * insertion position of the delegate via the `_currDelegateNewPosPrev` and `_currDelegateNewPosNext` params.
     * In both cases, a linear search will be executed starting at the hint to find the correct position. In the best case, the hint
     * is the correct position so no search is executed. See SortedDoublyLL.sol for details on list hints
     * @param _amount The amount of tokens to stake.
     * @param _orchestrator The address of the transcoder to stake towards
     * @param _for The address which will own the stake
     * @param _oldDelegateNewPosPrev The address of the previous transcoder in the pool for the old delegate
     * @param _oldDelegateNewPosNext The address of the next transcoder in the pool for the old delegate
     * @param _currDelegateNewPosPrev The address of the previous transcoder in the pool for the current delegate
     * @param _currDelegateNewPosNext The address of the next transcoder in the pool for the current delegate
     */
    function bond(
        uint256 _amount,
        address _orchestrator,
        address _for,
        address _oldDelegateNewPosPrev,
        address _oldDelegateNewPosNext,
        address _currDelegateNewPosPrev,
        address _currDelegateNewPosNext
    ) internal whenSystemNotPaused currentRoundInitialized autoClaimFees(_orchestrator) {
        if (_orchestrator != _for) {
            require(!isRegisteredOrchestrator(_for), "ORCHESTRATOR_CAN_NOT_DELEGATE");
        }

        // cannot delegate zero amount
        require(_amount > 0, "ZERO_DELEGATION_AMOUNT");

        // Bond total to stake to new orchestrator
        Delegations.Pool storage newPool = orchestrators[_orchestrator].delegationPool;
        uint256 oldTotalStake = newPool.poolTotalStake();
        newPool.stake(_for, _amount);

        _increaseOrchTotalStake(
            _orchestrator,
            oldTotalStake,
            _amount,
            _currDelegateNewPosPrev,
            _currDelegateNewPosNext
        );

        // Transfer the LPT to the Minter
        livepeerToken().transferFrom(_for, address(minter()), _amount);

        emit Bond(_orchestrator, _for, _amount, newPool.stakeOf(_for));
    }

    /**
     * @notice Unbond an amount of the delegator's bonded stake
     * @param _amount Amount of tokens to unbond
     */
    function unbond(uint256 _amount) external {
        unbondWithHint(msg.sender, _amount, address(0), address(0));
    }

    /**
     * @notice Unbond an amount of the delegator's bonded stake and updates the transcoder pool using an optional list hint if needed
     * @dev If the caller remains in the transcoder pool, the caller can provide an optional hint for its insertion position in the
     * pool via the `_newPosPrev` and `_newPosNext` params. A linear search will be executed starting at the hint to find the correct position.
     * In the best case, the hint is the correct position so no search is executed. See SortedDoublyLL.sol details on list hints
     * @param _amount Amount of tokens to unbond
     * @param _newPosPrev Address of previous transcoder in pool if the caller remains in the pool
     * @param _newPosNext Address of next transcoder in pool if the caller remains in the pool
     */
    function unbondWithHint(
        address _delegate,
        uint256 _amount,
        address _newPosPrev,
        address _newPosNext
    ) public whenSystemNotPaused currentRoundInitialized autoClaimFees(_delegate) {
        require(_amount > 0, "ZERO_UNBOND_AMOUNT");

        uint256 delegatorStake = stakeOf(_delegate, msg.sender);
        require(delegatorStake > 0, "CALLER_NOT_BONDED");
        require(_amount <= delegatorStake, "AMOUNT_EXCEEDS_STAKE");

        uint256 amount = _amount;

        // If the delegator is an orchestrator, draw from commission first
        if (msg.sender == _delegate) {
            Orchestrator storage orch = orchestrators[_delegate];
            uint256 rewardCommissions = orch.rewardCommissions;
            uint256 fromCommission = MathUtils.min(rewardCommissions, amount);
            amount -= fromCommission;

            if (orchestratorPoolV2.contains(msg.sender)) {
                if (_amount == delegatorStake) {
                    _resignOrchestrator(msg.sender);
                } else {
                    _decreaseOrchTotalStake(msg.sender, delegatorStake, _amount, _newPosPrev, _newPosNext);
                }
            }

            orch.rewardCommissions -= fromCommission;
        }

        if (amount > 0) {
            Delegations.Pool storage pool = orchestrators[_delegate].delegationPool;
            pool.unstake(msg.sender, amount);
        }

        // Create unbonding lock for _amount
        uint256 id = lastUnbondingLockID;
        lastUnbondingLockID++;

        uint256 currentRound = roundsManager().currentRound();

        unbondingLocks[id] = UnbondingLock({ orchestrator: _delegate, amount: _amount, withdrawRound: currentRound });

        emit Unbond(_delegate, msg.sender, id, _amount, currentRound);
    }

    /**
     * @notice Rebond tokens for an unbonding lock to a delegator's current 
        delegate while a delegator is in the Bonded or Pending status
     * @param _unbondingLockId ID of unbonding lock to rebond with
     */
    function rebond(uint256 _unbondingLockId) external {
        rebondWithHint(_unbondingLockId, address(0), address(0));
    }

    /**
     * @notice Rebond tokens for an unbonding lock to a delegator's current delegate while a delegator is in the Bonded or Pending status and updates
     * the transcoder pool using an optional list hint if needed
     * @dev If the delegate is in the transcoder pool, the caller can provide an optional hint for the delegate's insertion position in the
     * pool via the `_newPosPrev` and `_newPosNext` params. A linear search will be executed starting at the hint to find the correct position.
     * In the best case, the hint is the correct position so no search is executed. See SortedDoublyLL.sol details on list hints
     * @param _unbondingLockId ID of unbonding lock to rebond with
     * @param _newPosPrev Address of previous transcoder in pool if the delegate is in the pool
     * @param _newPosNext Address of next transcoder in pool if the delegate is in the pool
     */
    function rebondWithHint(
        uint256 _unbondingLockId,
        address _newPosPrev,
        address _newPosNext
    ) public whenSystemNotPaused currentRoundInitialized {
        // Process rebond using unbonding lock
        _processRebond(msg.sender, _unbondingLockId, _newPosPrev, _newPosNext);
    }

    /**
     * @notice Rebond tokens for an unbonding lock to a delegate while a delegator is in the Unbonded status
     * @param _to Address of delegate
     * @param _unbondingLockId ID of unbonding lock to rebond with
     */
    function rebondFromUnbonded(address _to, uint256 _unbondingLockId) external {
        rebondFromUnbondedWithHint(_to, _unbondingLockId, address(0), address(0));
    }

    /**
     * @notice Rebond tokens for an unbonding lock to a delegate while a delegator is in the Unbonded status and updates the transcoder pool using
     * an optional list hint if needed
     * @dev If the delegate joins the transcoder pool, the caller can provide an optional hint for the delegate's insertion position in the
     * pool via the `_newPosPrev` and `_newPosNext` params. A linear search will be executed starting at the hint to find the correct position.
     * In the best case, the hint is the correct position so no search is executed. See SortedDoublyLL.sol for details on list hints
     * @param _delegate Address of delegate
     * @param _unbondingLockId ID of unbonding lock to rebond with
     * @param _newPosPrev Address of previous transcoder in pool if the delegate joins the pool
     * @param _newPosNext Address of next transcoder in pool if the delegate joins the pool
     */
    function rebondFromUnbondedWithHint(
        address _delegate,
        uint256 _unbondingLockId,
        address _newPosPrev,
        address _newPosNext
    ) public whenSystemNotPaused currentRoundInitialized {
        require(stakeOf(_delegate, msg.sender) == 0, "CALLER_NOT_UNBONDED");

        unbondingLocks[_unbondingLockId].orchestrator = _delegate;
        // Process rebond using unbonding lock
        _processRebond(msg.sender, _unbondingLockId, _newPosPrev, _newPosNext);
    }

    /**
     * @notice Withdraws tokens for an unbonding lock that has existed through an unbonding period
     * @param _unbondingLockId ID of unbonding lock to withdraw with
     */
    function withdrawStake(uint256 _unbondingLockId) external whenSystemNotPaused currentRoundInitialized {
        UnbondingLock storage lock = unbondingLocks[_unbondingLockId];

        require(isValidUnbondingLock(_unbondingLockId), "invalid unbonding lock ID");
        require(
            lock.withdrawRound <= roundsManager().currentRound(),
            "withdraw round must be before or equal to the current round"
        );

        uint256 amount = lock.amount;
        uint256 withdrawRound = lock.withdrawRound;
        // Delete unbonding lock
        delete unbondingLocks[_unbondingLockId];

        // Tell Minter to transfer stake (LPT) to the delegator
        minter().trustedTransferTokens(msg.sender, amount);

        emit WithdrawStake(msg.sender, _unbondingLockId, amount, withdrawRound);
    }

    /**
     * @notice Withdraw fees for an address
     * @param _delegate Address of the delegate to claim fees from
     * @dev Calculates amount of fees to claim using `feesOf`
     * @dev Updates Delegation.feeCheckpoint for the address to the current total amount of fees in the delegation pool
     * @dev If the claimer is an orchestator, reset its commission
     * @dev Transfers funds
     */
    function withdrawFees(address _delegate) external whenSystemNotPaused currentRoundInitialized {
        _claimFees(_delegate, payable(msg.sender));
    }

    /**
     * ORCHESTRATOR ACTIONS
     */

    /**
     * @notice Sets commission rates as a transcoder and if the caller is not in the transcoder pool tries to add it
     * @dev Percentages are represented as numerators of fractions over MathUtils.PERC_DIVISOR
     * @param _rewardShare % of rewards paid to delegators by an orchestrator
     * @param _feeShare % of fees paid to delegators by a transcoder
     */
    function transcoder(uint256 _rewardShare, uint256 _feeShare) external {
        transcoderWithHint(_rewardShare, _feeShare, address(0), address(0));
    }

    /**
     * @notice Sets commission rates as a transcoder and if the caller is not in the transcoder pool tries to add it using an optional list hint
     * @dev Percentages are represented as numerators of fractions over MathUtils.PERC_DIVISOR. If the caller is going to be added to the pool, the
     * caller can provide an optional hint for the insertion position in the pool via the `_newPosPrev` and `_newPosNext` params. A linear search will
     * be executed starting at the hint to find the correct position - in the best case, the hint is the correct position so no search is executed.
     * See SortedDoublyLL.sol for details on list hints
     * @param _rewardShare % of reward paid to delegators by an orchestrator
     * @param _feeShare % of fees paid to delegators by a transcoder
     * @param _newPosPrev Address of previous transcoder in pool if the caller joins the pool
     * @param _newPosNext Address of next transcoder in pool if the caller joins the pool
     */
    function transcoderWithHint(
        uint256 _rewardShare,
        uint256 _feeShare,
        address _newPosPrev,
        address _newPosNext
    ) public whenSystemNotPaused currentRoundInitialized {
        require(!roundsManager().currentRoundLocked(), "CURRENT_ROUND_LOCKED");
        require(MathUtils.validPerc(_rewardShare), "REWARDSHARE_INVALID_PERC");
        require(MathUtils.validPerc(_feeShare), "FEESHARE_INVALID_PERC");
        require(isRegisteredOrchestrator(msg.sender), "ORCHESTRATOR_NOT_REGISTERED");

        Orchestrator storage o = orchestrators[msg.sender];
        uint256 currentRound = roundsManager().currentRound();

        require(!isActiveTranscoder(msg.sender) || o.lastRewardRound == currentRound, "COMMISSION_RATES_LOCKED");

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

        emit TranscoderUpdate(msg.sender, _rewardShare, _feeShare);
    }

    /**
     * @notice Mint token rewards for an active transcoder and its delegators
     */
    function reward() external {
        rewardWithHint(address(0), address(0));
    }

    /**
     * @notice Mint token rewards for an active transcoder and its delegators and update the transcoder pool using an optional list hint if needed
     * @dev If the caller is in the transcoder pool, the caller can provide an optional hint for its insertion position in the
     * pool via the `_newPosPrev` and `_newPosNext` params. A linear search will be executed starting at the hint to find the correct position.
     * In the best case, the hint is the correct position so no search is executed. See SortedDoublyLL.sol for details on list hints
     * @param _newPosPrev Address of previous transcoder in pool if the caller is in the pool
     * @param _newPosNext Address of next transcoder in pool if the caller is in the pool
     */
    function rewardWithHint(address _newPosPrev, address _newPosNext)
        public
        whenSystemNotPaused
        currentRoundInitialized
    {
        uint256 currentRound = roundsManager().currentRound();

        require(isActiveTranscoder(msg.sender), "caller must be an active transcoder");

        Orchestrator storage o = orchestrators[msg.sender];

        require(o.lastRewardRound != currentRound, "caller has already called reward for the current round");

        // Create reward based on active transcoder's stake relative to the total active stake
        // rewardTokens = (current mintable tokens for the round * active transcoder stake) / total active stake
        uint256 totalStake = o.delegationPool.poolTotalStake();
        uint256 rewardTokens = minter().createReward(totalStake, currentRoundTotalActiveStake);

        _updateOrchestratorWithRewards(msg.sender, rewardTokens);
        _increaseOrchTotalStake(msg.sender, totalStake, rewardTokens, _newPosPrev, _newPosNext);

        // Set last round that transcoder called reward
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
    function updateTranscoderWithFees(
        address _orchestrator,
        uint256 _fees,
        uint256 /*_round*/
    ) external override whenSystemNotPaused onlyTicketBroker {
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
     * @notice Return whether an unbonding lock for a delegator is valid
     * @param _unbondingLockId ID of unbonding lock
     * @return true if unbondingLock for ID has a non-zero withdraw round
     */
    function isValidUnbondingLock(uint256 _unbondingLockId) public view returns (bool) {
        // A unbonding lock is only valid if it has a non-zero withdraw round (the default value is zero)
        return unbondingLocks[_unbondingLockId].withdrawRound > 0;
    }

    function getDelegation(address _delegate, address _delegator) public view returns (uint256 stake, uint256 fees) {
        (stake, fees) = orchestrators[_delegate].delegationPool.stakeAndFeesOf(_delegator);
    }

    /**
     * @notice Calculate the total stake for an address
     * @dev Calculates the amount of tokens represented by the address' share of the delegation pool
     * @dev If the address is an orchestrator, add its commission
     * @dev Delegators don't need support fetching on-chain stake directly,
        so for multi-delegation we can do calculations off chain
        and repurpose this to 'orchestratorStake(address _orchestrator)'
     */
    function stakeOf(address _delegate, address _delegator) public view returns (uint256 stake) {
        Orchestrator storage orch = orchestrators[_delegate];
        stake = orch.delegationPool.stakeOf(_delegator);
        if (_delegate == _delegator) {
            stake += orch.rewardCommissions;
        }
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
    function feesOf(address _delegate, address _delegator) public view returns (uint256 fees) {
        Orchestrator storage orch = orchestrators[_delegate];
        fees = orch.delegationPool.feesOf(_delegator);
        if (_delegate == _delegator) {
            fees += orch.feeCommissions;
        }
    }

    /**
     * @notice Returns total bonded stake for a transcoder
     * @param _orchestrator Address of transcoder
     * @return total bonded stake for a delegator
     */
    function orchestratorTotalStake(address _orchestrator) public view returns (uint256) {
        return orchestrators[_orchestrator].delegationPool.poolTotalStake();
    }

    /**
     * @notice Return whether a transcoder is registered
     * @param _orchestrator Transcoder address
     * @return true if transcoder is self-bonded
     */
    function isRegisteredOrchestrator(address _orchestrator) public view returns (bool) {
        return orchestrators[_orchestrator].delegationPool.stakeOf(_orchestrator) > 0;
    }

    /**
     * @notice Return whether a transcoder is active for the current round
     * @param _orchestrator Transcoder address
     * @return true if transcoder is active
     */
    function isActiveTranscoder(address _orchestrator) public view override returns (bool) {
        Orchestrator storage o = orchestrators[_orchestrator];
        uint256 currentRound = roundsManager().currentRound();
        return o.activationRound <= currentRound && currentRound < o.deactivationRound;
    }

    /**
     * @notice Computes transcoder status
     * @param _orchestrator Address of transcoder
     * @return active, registered or not registered transcoder status
     */
    function orchestratorStatus(address _orchestrator) public view returns (OrchestratorStatus) {
        if (isActiveTranscoder(_orchestrator)) return OrchestratorStatus.Active;
        if (isRegisteredOrchestrator(_orchestrator)) return OrchestratorStatus.Registered;
        return OrchestratorStatus.NotRegistered;
    }

    /**
     * @notice Returns max size of transcoder pool
     * @return transcoder pool max size
     */
    function getTranscoderPoolMaxSize() public view returns (uint256) {
        return orchestratorPoolV2.getMaxSize();
    }

    /**
     * @notice Returns size of transcoder pool
     * @return transcoder pool current size
     */
    function getTranscoderPoolSize() public view override returns (uint256) {
        return orchestratorPoolV2.getSize();
    }

    /**
     * @notice Returns transcoder with most stake in pool
     * @return address for transcoder with highest stake in transcoder pool
     */
    function getFirstTranscoderInPool() public view returns (address) {
        return orchestratorPoolV2.getFirst();
    }

    /**
     * @notice Returns next transcoder in pool for a given transcoder
     * @param _orchestrator Address of a transcoder in the pool
     * @return address for the transcoder after '_transcoder' in transcoder pool
     */
    function getNextTranscoderInPool(address _orchestrator) public view returns (address) {
        return orchestratorPoolV2.getNext(_orchestrator);
    }

    /**
     * @notice Return total bonded tokens
     * @return total active stake for the current round
     */
    function getTotalBonded() public view override returns (uint256) {
        return currentRoundTotalActiveStake;
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

        orch.rewardCommissions = _rewards - rewardShare;
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
     * @dev Remove a transcoder from the pool and deactivate it
     */
    function _resignOrchestrator(address _orchestrator) internal {
        // Not zeroing 'Transcoder.lastActiveStakeUpdateRound' saves gas (5k when transcoder is evicted and 20k when transcoder is reinserted)
        // There should be no side-effects as long as the value is properly updated on stake updates
        // Not zeroing the stake on the current round's 'EarningsPool' saves gas and should have no side effects as long as
        // 'EarningsPool.setStake()' is called whenever a transcoder becomes active again.
        orchestratorPoolV2.remove(_orchestrator);
        nextRoundTotalActiveStake -= orchestratorTotalStake(_orchestrator);
        uint256 deactivationRound = roundsManager().currentRound() + 1;
        orchestrators[_orchestrator].deactivationRound = deactivationRound;
        emit TranscoderDeactivated(_orchestrator, deactivationRound);
    }

    /**
     * @dev Tries to add a transcoder to active transcoder pool, evicts the active transcoder with the lowest stake if the pool is full
     * @param _orchestrator The transcoder to insert into the transcoder pool
     * @param _totalStake The total stake for '_transcoder'
     * @param _activationRound The round in which the transcoder should become active
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

            // If the pool is full and the transcoder has less stake than the least stake transcoder in the pool
            // then the transcoder is unable to join the active set for the next round
            if (_totalStake <= lastStake) {
                return;
            }

            // Evict the least stake transcoder from the active set for the next round
            // Not zeroing 'Transcoder.lastActiveStakeUpdateRound' saves gas (5k when transcoder is evicted and 20k when transcoder is reinserted)
            // There should be no side-effects as long as the value is properly updated on stake updates
            // Not zeroing the stake on the current round's 'EarningsPool' saves gas and should have no side effects as long as
            // 'EarningsPool.setStake()' is called whenever a transcoder becomes active again.
            orchestratorPoolV2.remove(lastOrchestrator);
            orchestrators[lastOrchestrator].deactivationRound = _activationRound;
            pendingNextRoundTotalActiveStake = pendingNextRoundTotalActiveStake - lastStake;

            emit TranscoderDeactivated(lastOrchestrator, _activationRound);
        }

        orchestratorPoolV2.insert(_orchestrator, _totalStake, _newPosPrev, _newPosNext);
        pendingNextRoundTotalActiveStake = pendingNextRoundTotalActiveStake + _totalStake;
        Orchestrator storage o = orchestrators[_orchestrator];
        o.activationRound = _activationRound;
        o.deactivationRound = MAX_FUTURE_ROUND;
        nextRoundTotalActiveStake = pendingNextRoundTotalActiveStake;
        emit TranscoderActivated(_orchestrator, _activationRound);
    }

    /**
     * @dev Update the state of a delegator and its delegate by processing a rebond using an unbonding lock and update the transcoder pool with an optional
     * list hint if needed. See SortedDoublyLL.sol for details on list hints
     * @param _delegator Address of delegator
     * @param _unbondingLockId ID of unbonding lock to rebond with
     * @param _newPosPrev Address of previous transcoder in pool if the delegate is already in or joins the pool
     * @param _newPosNext Address of next transcoder in pool if the delegate is already in or joins the pool
     */
    function _processRebond(
        address _delegator,
        uint256 _unbondingLockId,
        address _newPosPrev,
        address _newPosNext
    ) internal {
        UnbondingLock storage lock = unbondingLocks[_unbondingLockId];

        require(isValidUnbondingLock(_unbondingLockId), "invalid unbonding lock ID");

        uint256 amount = lock.amount;
        address delegate = lock.orchestrator;

        require(amount > 0, "ZERO_AMOUNT");

        // Claim outstanding fees
        _claimFees(delegate, payable(_delegator));

        // Increase delegator's bonded amount
        uint256 oldStake = stakeOf(delegate, _delegator);
        orchestrators[delegate].delegationPool.stake(_delegator, amount);

        // Delete lock
        delete unbondingLocks[_unbondingLockId];

        _increaseOrchTotalStake(delegate, oldStake, amount, _newPosPrev, _newPosNext);
        emit Rebond(delegate, _delegator, _unbondingLockId, amount);
    }

    /**
     * @notice Withdraw fees for an address
     * @dev Calculates amount of fees to claim using `feesOf`
     * @dev Updates Delegation.feeCheckpoint for the address to the current total amount of fees in the delegation pool
     * @dev If the claimer is an orchestator, reset its commission
     * @dev Transfer funds
     * @dev NOTE: currently doesn't support multi-delegation, would have to add an orchestrator address param
     */
    function _claimFees(address _delegate, address payable _for) internal {
        Orchestrator storage orch = orchestrators[_delegate];
        uint256 fees = orch.delegationPool.claimFees(_for);
        if (_for == _delegate) {
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
        require(msg.sender == controller.getContract(keccak256("TicketBroker")), "caller must be TicketBroker");
    }

    function _onlyRoundsManager() internal view {
        require(msg.sender == controller.getContract(keccak256("RoundsManager")), "caller must be RoundsManager");
    }

    function _onlyVerifier() internal view {
        require(msg.sender == controller.getContract(keccak256("Verifier")), "caller must be Verifier");
    }

    function _currentRoundInitialized() internal view {
        require(roundsManager().currentRoundInitialized(), "current round is not initialized");
    }
}
