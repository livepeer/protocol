// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;
import "./BondingManagerRetroactiveRewardCalculationPoC.sol";
import "contracts/bonding/BondingManager.sol";

// forge test --match-contract BondingManagerRetroactiveRewardCalculationFix --fork-url https://arbitrum-mainnet.infura.io/v3/$INFURA_KEY -vvv
contract BondingManagerRetroactiveRewardCalculationFix is BondingManagerRetroactiveRewardCalculationPoC {
    bytes32 public constant BONDING_MANAGER_TARGET_ID = keccak256("BondingManagerTarget");
    BondingManager public newBondingManagerTarget = new BondingManager(address(CONTROLLER));

    function _deployUpgrade() internal {
        stageAndExecuteOne(
            address(CONTROLLER),
            0,
            abi.encodeWithSelector(
                CONTROLLER.setContractInfo.selector,
                BONDING_MANAGER_TARGET_ID,
                address(newBondingManagerTarget),
                bytes32(0)
            )
        );
    }

    function testUpgrade() public {
        _deployUpgrade();
        (address infoAddr, ) = CONTROLLER.getContractInfo(BONDING_MANAGER_TARGET_ID);
        assertEq(infoAddr, address(newBondingManagerTarget));
    }

    function _delta(uint256 a, uint256 b) internal pure returns (int256) {
        return a >= b ? int256(a - b) : -int256(b - a);
    }

    function _abs(int256 x) internal pure returns (uint256) {
        return uint256(x >= 0 ? x : -x);
    }

    function testFeeFactorEqualityAfterUpgrade() public {
        // Pre-upgrade measurement
        CHEATS.revertToState(baselineSnapshot);
        FeeMetrics memory baselineConsecutive = _scenarioConsecutive();
        CHEATS.revertToState(baselineSnapshot);
        FeeMetrics memory baselineMissed = _scenarioMissed();
        int256 preUpgradeDelta = _delta(
            baselineMissed.cumulativeFeeFactorInc,
            baselineConsecutive.cumulativeFeeFactorInc
        );

        // Post-upgrade measurement
        CHEATS.revertToState(baselineSnapshot);
        _deployUpgrade();
        FeeMetrics memory postConsecutive = _scenarioConsecutive();
        CHEATS.revertToState(baselineSnapshot);
        _deployUpgrade();
        FeeMetrics memory postMissed = _scenarioMissed();
        int256 postUpgradeDelta = _delta(postMissed.cumulativeFeeFactorInc, postConsecutive.cumulativeFeeFactorInc);

        // Sanity: identical commission parameters preserved
        assertEq(postConsecutive.feeShare, postMissed.feeShare, "feeShare mismatch");
        assertEq(postConsecutive.commission, postMissed.commission, "commission mismatch");

        // Post-upgrade delta less than 1% of pre-upgrade delta
        uint256 deltaTolerance = _abs(preUpgradeDelta) / 100000;
        if (deltaTolerance == 0) deltaTolerance = 1;

        assertTrue(_abs(postUpgradeDelta) <= deltaTolerance, "fee factor deflation persists");

        emit log_named_uint("preUpgrade_cumulativeFeeFactor_missed", baselineMissed.cumulativeFeeFactor);
        emit log_named_uint("preUpgrade_cumulativeFeeFactor_consec", baselineConsecutive.cumulativeFeeFactor);
        emit log_named_uint("aftUpgrade_cumulativeFeeFactor_missed", postMissed.cumulativeFeeFactor);
        emit log_named_uint("aftUpgrade_cumulativeFeeFactor_consec", postConsecutive.cumulativeFeeFactor);
        emit log_named_int("preUpgrade_cumulativeFeeFactor_delta", preUpgradeDelta);
        emit log_named_int("aftUpgrade_cumulativeFeeFactor_delta", postUpgradeDelta);
    }

    function testDelegatorNoFeeLossAfterUpgrade() public {
        // Pre-upgrade measurement
        CHEATS.revertToState(baselineSnapshot);
        _bondDelegator(testDelegator, 1 ether);
        _scenarioConsecutive();
        CHEATS.prank(testDelegator);
        BONDING_MANAGER.claimEarnings(type(uint256).max);
        (, uint256 baseFeesCons, , , , , ) = BONDING_MANAGER.getDelegator(testDelegator);

        CHEATS.revertToState(baselineSnapshot);
        _bondDelegator(testDelegator, 1 ether);
        _scenarioMissed();
        CHEATS.prank(testDelegator);
        BONDING_MANAGER.claimEarnings(type(uint256).max);
        (, uint256 baseFeesMiss, , , , , ) = BONDING_MANAGER.getDelegator(testDelegator);
        int256 preUpgradeDeltaFees = _delta(baseFeesMiss, baseFeesCons);

        // Post-upgrade measurement
        CHEATS.revertToState(baselineSnapshot);
        _deployUpgrade();
        _bondDelegator(testDelegator, 1 ether);
        _scenarioConsecutive();
        CHEATS.prank(testDelegator);
        BONDING_MANAGER.claimEarnings(type(uint256).max);
        (, uint256 postFeesCons, , , , , ) = BONDING_MANAGER.getDelegator(testDelegator);

        CHEATS.revertToState(baselineSnapshot);
        _deployUpgrade();
        _bondDelegator(testDelegator, 1 ether);
        _scenarioMissed();
        CHEATS.prank(testDelegator);
        BONDING_MANAGER.claimEarnings(type(uint256).max);
        (, uint256 postFeesMiss, , , , , ) = BONDING_MANAGER.getDelegator(testDelegator);
        int256 postUpgradeDeltaFees = _delta(postFeesMiss, postFeesCons);

        // Post-upgrade delta less than 1% of pre-upgrade delta
        uint256 deltaToleranceFees = _abs(preUpgradeDeltaFees) / 100000;
        if (deltaToleranceFees == 0) deltaToleranceFees = 1;

        assertTrue(_abs(postUpgradeDeltaFees) <= deltaToleranceFees, "delegator fee loss not mitigated sufficiently");

        emit log_named_uint("preUpgrade_delegatorFees_consec", baseFeesCons);
        emit log_named_uint("preUpgrade_delegatorFees_missed", baseFeesMiss);
        emit log_named_uint("aftUpgrade_delegatorFees_consec", postFeesCons);
        emit log_named_uint("aftUpgrade_delegatorFees_missed", postFeesMiss);
        emit log_named_int("preUpgrade_delegatorFees_delta", preUpgradeDeltaFees);
        emit log_named_int("aftUpgrade_delegatorFees_delta", postUpgradeDeltaFees);
    }
}
