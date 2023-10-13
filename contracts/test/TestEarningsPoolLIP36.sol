// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./mocks/EarningsPoolFixture.sol";
import "./helpers/truffle/Assert.sol";
import "../libraries/PreciseMathUtils.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract TestEarningsPoolLIP36 {
    using SafeMath for uint256;

    EarningsPoolFixture fixture;

    function beforeEach() public {
        fixture = new EarningsPoolFixture();
        fixture.setStake(1000);
        fixture.setCommission(500000, 500000);
    }

    function test_updateCumulativeFeeFactor_no_prevEarningsPool() public {
        uint256 fees = 1000;

        // earningsPool.cumulativeFeeFactor == 0
        // prevEarningsPool.cumulativeFeeFactor == 0
        // prevEarningsPool.cumulativeRewardFactor == 0
        fixture.updateCumulativeFeeFactor(fees);
        uint256 expFeeFactor = PreciseMathUtils.percPoints(fees, fixture.getTotalStake());
        Assert.equal(fixture.getCumulativeFeeFactor(), expFeeFactor, "should set cumulativeFeeFactor");

        // earningsPool.cumulativeFeeFactor != 0
        fixture.updateCumulativeFeeFactor(fees);
        expFeeFactor = expFeeFactor.add(PreciseMathUtils.percPoints(fees, fixture.getTotalStake()));
        Assert.equal(fixture.getCumulativeFeeFactor(), expFeeFactor, "should update cumulativeFeeFactor");
    }

    function test_updateCumulativeFeeFactor_prevEarningsPool() public {
        uint256 fees = 200;

        // prevEarningsPool.cumulativeFeeFactor = 2
        // prevEarningsPool.cumulativeRewardFactor = 3
        uint256 prevFeeFactor = 2;
        uint256 prevRewFactor = 3;
        fixture.setPrevPoolEarningsFactors(prevFeeFactor, prevRewFactor);

        // earningsPool.cumulativeFeeFactor == 0
        fixture.updateCumulativeFeeFactor(fees);
        uint256 expFeeFactor = prevFeeFactor.add(PreciseMathUtils.percOf(prevRewFactor, fees, fixture.getTotalStake()));
        Assert.equal(fixture.getCumulativeFeeFactor(), expFeeFactor, "should update cumulativeFeeFactor");

        // earningsPool.cumulativeFeeFactor != 0
        fixture.updateCumulativeFeeFactor(fees);
        expFeeFactor = expFeeFactor.add(PreciseMathUtils.percOf(prevRewFactor, fees, fixture.getTotalStake()));
    }

    function test_updateCumulativeRewardFactor() public {
        uint256 rewards = 1000;

        // prevEarningsPool.cumulativeRewardFactor == 0
        uint256 expRewardFactor = PreciseMathUtils.percPoints(1, 1).add(
            PreciseMathUtils.percOf(PreciseMathUtils.percPoints(1, 1), rewards, fixture.getTotalStake())
        );
        fixture.updateCumulativeRewardFactor(1000);
        Assert.equal(expRewardFactor, fixture.getCumulativeRewardFactor(), "incorrect cumulative reward factor");

        // prevEarningsPool.cumulativeRewardFactor != 0
        fixture.setPrevPoolEarningsFactors(0, expRewardFactor);
        expRewardFactor = expRewardFactor.add(
            PreciseMathUtils.percOf(expRewardFactor, rewards, fixture.getTotalStake())
        );
        fixture.updateCumulativeRewardFactor(1000);
        Assert.equal(expRewardFactor, fixture.getCumulativeRewardFactor(), "incorrect cumulative reward factor");
    }

    function test_delegatorCumulativeFees() public {
        uint256 stake = 1000;
        uint256 fees = 10;

        // all zeroed factors, should just return current fees
        Assert.equal(10, fixture.delegatorCumulativeFees(stake, fees), "incorrect delegator cumulative fees");

        fixture.setPrevPoolEarningsFactors(3, 2);
        fixture.setEarningsFactors(3, 2);

        // no increased fee factor yet, should still return current fees
        Assert.equal(10, fixture.delegatorCumulativeFees(stake, fees), "incorrect delegator cumulative fees");

        fixture.setEarningsFactors(6, 0); // end pool reward factor should not be used, set as 0

        // earned fees = 1000 * (6 - 3) / 2 = 1500
        Assert.equal(1510, fixture.delegatorCumulativeFees(stake, fees), "incorrect delegator cumulative fees");
    }

    function test_delegatorCumulativeStake() public {
        uint256 stake = 1000;

        // all zeroed factors, should just return current stake
        Assert.equal(1000, fixture.delegatorCumulativeStake(stake), "incorrect delegator cumulative stake");

        fixture.setPrevPoolEarningsFactors(0, 4);
        fixture.setEarningsFactors(0, 4);

        // no increased reward factor yet, should still return current stake
        Assert.equal(1000, fixture.delegatorCumulativeStake(stake), "incorrect delegator cumulative stake");

        fixture.setEarningsFactors(0, 10);

        // stake = 1000 * 10 / 4 = 2500
        Assert.equal(2500, fixture.delegatorCumulativeStake(stake), "incorrect delegator cumulative stake");
    }

    function test_delegatorCumulativeStakeAndFees() public {
        uint256 stake = 1000;
        uint256 fees = 10;

        // all zeroed factors, should just return current stake
        (uint256 cStake, uint256 cFees) = fixture.delegatorCumulativeStakeAndFees(stake, fees);
        Assert.equal(1000, cStake, "incorrect delegator cumulative stake");
        Assert.equal(10, cFees, "incorrect delegator cumulative fee");

        fixture.setPrevPoolEarningsFactors(2, 5);
        fixture.setEarningsFactors(2, 5);

        // no increased factors yet, should still return current values
        (cStake, cFees) = fixture.delegatorCumulativeStakeAndFees(stake, fees);
        Assert.equal(1000, cStake, "incorrect delegator cumulative stake");
        Assert.equal(10, cFees, "incorrect delegator cumulative fee");

        fixture.setEarningsFactors(5, 15);

        (cStake, cFees) = fixture.delegatorCumulativeStakeAndFees(stake, fees);
        // stake = 1000 * 15 / 5 = 3000
        Assert.equal(3000, cStake, "incorrect delegator cumulative stake");
        // earned fees = 1000 * (5 - 2) / 5 = 600
        Assert.equal(610, cFees, "incorrect delegator cumulative fee");
    }
}
