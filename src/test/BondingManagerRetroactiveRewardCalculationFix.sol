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

    function _scenarioConsecutive() internal override returns (FeeMetrics memory) {
        _deployUpgrade();
        return super._scenarioConsecutive();
    }

    function _scenarioMissed() internal override returns (FeeMetrics memory) {
        _deployUpgrade();
        return super._scenarioMissed();
    }

    function _validateFeeFactor(uint256 consecutive, uint256 missed) internal override {
        // We use 1e12 as a safe tolerance for the estimated fee factor
        assertApproxEqAbs(consecutive, missed, 1e12, "Fee factor deflation persists");
    }

    function _validateDelegatorFees(uint256 consecutive, uint256 missed) internal override {
        // We use 1e1 as a safe tolerance for the estimated delegator fees
        assertApproxEqAbs(consecutive, missed, 1e1, "Delegator fee loss persists");
    }
}
