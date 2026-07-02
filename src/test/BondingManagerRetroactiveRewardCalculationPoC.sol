// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;
import "./base/GovernorBaseTest.sol";
import "contracts/rounds/RoundsManager.sol";
import "contracts/token/LivepeerToken.sol";
import "contracts/bonding/BondingManager.sol";
import "contracts/libraries/MathUtils.sol";

// forge test --match-contract BondingManagerRetroactiveRewardCalculationPoC --fork-url https://arbitrum-mainnet.infura.io/v3/$INFURA_KEY -vvv
contract BondingManagerRetroactiveRewardCalculationPoC is GovernorBaseTest {
    BondingManager public immutable BONDING_MANAGER;
    RoundsManager public immutable ROUNDS_MANAGER;
    LivepeerToken public immutable TOKEN;

    address public immutable MINTER_ADDRESS;
    address public immutable TICKET_BROKER;

    constructor() {
        BONDING_MANAGER = BondingManager(getContract("BondingManager"));
        ROUNDS_MANAGER = RoundsManager(getContract("RoundsManager"));
        TOKEN = LivepeerToken(getContract("LivepeerToken"));
        MINTER_ADDRESS = getContract("Minter");
        TICKET_BROKER = getContract("TicketBroker");
    }

    uint256 public constant TEST_FEES = 1 ether;

    address public transcoder;
    uint256 public baselineSnapshot;
    address public testDelegator;

    function setUp() public {
        transcoder = BONDING_MANAGER.getFirstTranscoderInPool();
        testDelegator = newAddr();
        CHEATS.deal(testDelegator, 100 ether);
        baselineSnapshot = CHEATS.snapshotState();
    }

    function _nextRound() internal {
        uint256 currentRoundStartBlock = ROUNDS_MANAGER.currentRoundStartBlock();
        uint256 roundLength = ROUNDS_MANAGER.roundLength();
        CHEATS.roll(currentRoundStartBlock + roundLength);
        ROUNDS_MANAGER.initializeRound();
    }

    function _updateFees(uint256 round) internal {
        CHEATS.prank(TICKET_BROKER);
        BONDING_MANAGER.updateTranscoderWithFees(transcoder, TEST_FEES, round);
    }

    struct FeeMetrics {
        uint256 cumulativeFeesInc; // delta transcoder.cumulativeFees
        uint256 commission; // expected commission = (1 - feeShare) * TEST_FEES
        uint256 feeShare; // feeShare percentage value
        uint256 cumulativeFeeFactor; // cumulativeFeeFactor after scenario
        uint256 cumulativeFeeFactorInc; // change in cumulativeFeeFactor after scenario
        uint256 rewardFactorCurrent; // cumulativeRewardFactor in fee round
        uint256 rewardFactorBefore; // cumulativeRewardFactor Previous round
    }

    function _scenarioConsecutive() internal virtual returns (FeeMetrics memory m) {
        _nextRound(); // R1, normal reward claim
        CHEATS.prank(transcoder);
        BONDING_MANAGER.reward();
        _nextRound(); // R2, reward claim and fee update
        CHEATS.prank(transcoder);
        BONDING_MANAGER.reward();

        uint256 currentRound = ROUNDS_MANAGER.currentRound();
        (, , uint256 feeShareNow, , uint256 feeFactorBefore) = BONDING_MANAGER.getTranscoderEarningsPoolForRound(
            transcoder,
            currentRound
        );
        (, , , uint256 rewardFactorBefore, ) = BONDING_MANAGER.getTranscoderEarningsPoolForRound(
            transcoder,
            currentRound - 1
        );
        (, , , , , , , , uint256 cumulativeFeesBefore, ) = BONDING_MANAGER.getTranscoder(transcoder);

        uint256 commission = TEST_FEES - MathUtils.percOf(TEST_FEES, feeShareNow);

        _updateFees(currentRound);

        (, , , uint256 rewardFactorAfter, uint256 feeFactorAfter) = BONDING_MANAGER.getTranscoderEarningsPoolForRound(
            transcoder,
            currentRound
        );
        (, , , , , , , , uint256 cumulativeFeesAfter, ) = BONDING_MANAGER.getTranscoder(transcoder);

        m.cumulativeFeesInc = cumulativeFeesAfter - cumulativeFeesBefore;
        m.commission = commission;
        m.feeShare = feeShareNow;
        m.cumulativeFeeFactor = feeFactorAfter;
        m.cumulativeFeeFactorInc = feeFactorAfter - feeFactorBefore;
        m.rewardFactorCurrent = rewardFactorAfter;
        m.rewardFactorBefore = rewardFactorBefore;
    }

    function _scenarioMissed() internal virtual returns (FeeMetrics memory m) {
        _nextRound(); // R1, normal reward claim
        CHEATS.prank(transcoder);
        BONDING_MANAGER.reward();
        _nextRound(); // R2, skip reward
        _nextRound(); // R3 reward claim and fee update after previous round reward skip
        CHEATS.prank(transcoder);
        BONDING_MANAGER.reward();

        uint256 currentRound = ROUNDS_MANAGER.currentRound();
        (, , uint256 feeShareNow, , uint256 feeFactorBefore) = BONDING_MANAGER.getTranscoderEarningsPoolForRound(
            transcoder,
            currentRound
        );
        (, , , uint256 rewardFactorBefore, ) = BONDING_MANAGER.getTranscoderEarningsPoolForRound(
            transcoder,
            currentRound - 1
        ); // expected 0
        (, , , , , , , , uint256 cumulativeFeesBefore, ) = BONDING_MANAGER.getTranscoder(transcoder);

        uint256 commission = TEST_FEES - MathUtils.percOf(TEST_FEES, feeShareNow);

        _updateFees(currentRound);

        (, , , uint256 rewardFactorAfter, uint256 feeFactorAfter) = BONDING_MANAGER.getTranscoderEarningsPoolForRound(
            transcoder,
            currentRound
        );
        (, , , , , , , , uint256 cumulativeFeesAfter, ) = BONDING_MANAGER.getTranscoder(transcoder);

        m.cumulativeFeesInc = cumulativeFeesAfter - cumulativeFeesBefore;
        m.commission = commission;
        m.feeShare = feeShareNow;
        m.cumulativeFeeFactor = feeFactorAfter;
        m.cumulativeFeeFactorInc = feeFactorAfter - feeFactorBefore;
        m.rewardFactorCurrent = rewardFactorAfter;
        m.rewardFactorBefore = rewardFactorBefore;
    }

    function _validateFeeFactor(uint256 consecutive, uint256 missed) internal virtual {
        // Assert the bug exists (deflation is huge > 1e16)
        uint256 deflation = consecutive - missed;
        assertGt(deflation, 1e16, "Large fee deflation NOT detected");
    }

    function _validateDelegatorFees(uint256 consecutive, uint256 missed) internal virtual {
        // Calculate the absolute difference
        uint256 diff = consecutive > missed ? consecutive - missed : missed - consecutive;

        // Assert that the fee loss is greater than 1e1 wei
        assertGt(diff, 1e1, "Delegator fee loss is negligible (<= 10 wei)");
    }

    function testCompareConsecutiveAndMissedRewardClaims() public virtual {
        FeeMetrics memory consecutive = _scenarioConsecutive();
        CHEATS.revertToState(baselineSnapshot);
        FeeMetrics memory missed = _scenarioMissed();

        // Sanity: same feeShare and commission in both paths
        assertEq(consecutive.feeShare, missed.feeShare, "feeShare mismatch");
        assertEq(consecutive.commission, missed.commission, "commission mismatch");

        // Missed reward path deflates fee factor increment for identical fee update
        _validateFeeFactor(consecutive.cumulativeFeeFactorInc, missed.cumulativeFeeFactorInc);
    }

    function _bondDelegator(address delegator, uint256 amount) internal {
        CHEATS.prank(MINTER_ADDRESS);
        TOKEN.mint(delegator, amount);

        CHEATS.startPrank(delegator);
        TOKEN.approve(address(BONDING_MANAGER), amount);
        BONDING_MANAGER.bond(amount, transcoder);
        CHEATS.stopPrank();
    }

    function testDelegatorFeeLossOnMissedReward() public virtual {
        _bondDelegator(testDelegator, 1 ether);
        _scenarioConsecutive();
        CHEATS.prank(testDelegator);
        BONDING_MANAGER.claimEarnings(type(uint256).max);
        (, uint256 feesAfterCons, , , , , ) = BONDING_MANAGER.getDelegator(testDelegator);

        CHEATS.revertToState(baselineSnapshot);

        _bondDelegator(testDelegator, 1 ether);
        _scenarioMissed();
        CHEATS.prank(testDelegator);
        BONDING_MANAGER.claimEarnings(type(uint256).max);
        (, uint256 feesAfterMiss, , , , , ) = BONDING_MANAGER.getDelegator(testDelegator);

        _validateDelegatorFees(feesAfterCons, feesAfterMiss);
    }
}
