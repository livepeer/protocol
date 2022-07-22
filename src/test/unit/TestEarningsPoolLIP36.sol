// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "ds-test/test.sol";
import "contracts/test/mocks/EarningsPoolFixture.sol";
import "contracts/libraries/PreciseMathUtils.sol";
import "../interfaces/ICheatCodes.sol";

contract TestEarningsPoolLIP36 is DSTest {
    ICheatCodes public constant CHEATS = ICheatCodes(HEVM_ADDRESS);
    EarningsPoolFixture fixture;

    function setUp() public {
        fixture = new EarningsPoolFixture();
        fixture.setStake(1000);
        fixture.setCommission(500000, 500000);
    }

    function testUpdateCumulativeFeeFactorWithNoPrevEarningsPool() public {
        uint256 fees = 1000;

        // earningsPool.cumulativeFeeFactor == 0
        // prevEarningsPool.cumulativeFeeFactor == 0
        // prevEarningsPool.cumulativeRewardFactor == 0
        fixture.updateCumulativeFeeFactor(fees);
        uint256 expFeeFactor = PreciseMathUtils.percPoints(fees, fixture.getTotalStake());
        assertEq(fixture.getCumulativeFeeFactor(), expFeeFactor, "should set cumulativeFeeFactor");

        // earningsPool.cumulativeFeeFactor != 0
        fixture.updateCumulativeFeeFactor(fees);
        expFeeFactor += PreciseMathUtils.percPoints(fees, fixture.getTotalStake());
        assertEq(fixture.getCumulativeFeeFactor(), expFeeFactor, "should update cumulativeFeeFactor");
    }

    function testUpdateCumulativeFeeFactorWithPrevEarningsPool() public {
        uint256 fees = 200;

        // prevEarningsPool.cumulativeFeeFactor = 2
        // prevEarningsPool.cumulativeRewardFactor = 3
        uint256 prevFeeFactor = 2;
        uint256 prevRewFactor = 3;
        fixture.setPrevPoolEarningsFactors(prevFeeFactor, prevRewFactor);

        // earningsPool.cumulativeFeeFactor == 0
        fixture.updateCumulativeFeeFactor(fees);
        uint256 expFeeFactor = prevFeeFactor + PreciseMathUtils.percOf(prevRewFactor, fees, fixture.getTotalStake());
        assertEq(fixture.getCumulativeFeeFactor(), expFeeFactor, "should update cumulativeFeeFactor");

        // earningsPool.cumulativeFeeFactor != 0
        fixture.updateCumulativeFeeFactor(fees);
        expFeeFactor += PreciseMathUtils.percOf(prevRewFactor, fees, fixture.getTotalStake());
    }

    function testUpdateCumulativeRewardFactor() public {
        uint256 rewards = 1000;

        // prevEarningsPool.cumulativeRewardFactor == 0
        uint256 expRewardFactor = PreciseMathUtils.percPoints(1, 1) +
            PreciseMathUtils.percOf(PreciseMathUtils.percPoints(1, 1), rewards, fixture.getTotalStake());

        fixture.updateCumulativeRewardFactor(1000);
        assertEq(expRewardFactor, fixture.getCumulativeRewardFactor(), "incorrect cumulative reward factor");

        // prevEarningsPool.cumulativeRewardFactor != 0
        fixture.setPrevPoolEarningsFactors(0, expRewardFactor);
        expRewardFactor += PreciseMathUtils.percOf(expRewardFactor, rewards, fixture.getTotalStake());
        fixture.updateCumulativeRewardFactor(1000);
        assertEq(expRewardFactor, fixture.getCumulativeRewardFactor(), "incorrect cumulative reward factor");
    }
}
