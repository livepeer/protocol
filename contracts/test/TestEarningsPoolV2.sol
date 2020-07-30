pragma solidity ^0.5.11;

import "./mocks/EarningsPoolFixtureV2.sol";
import "./helpers/truffle/Assert.sol";
import "../libraries/MathUtils.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";


contract TestEarningsPoolV2 {
    using SafeMath for uint256;

    EarningsPoolFixture fixture;

    function beforeEach() public {
        fixture = new EarningsPoolFixture();
        fixture.setStake(1000);
        fixture.setCommission(500000, 500000);
    }

    function test_setCommission() public {
        fixture.setCommission(5, 10);
        (uint256 transcoderRewardCut, uint256 transcoderFeeShare) = fixture.getCommission();
        Assert.equal(transcoderRewardCut, 5, "wrong transcoderRewardCut");
        Assert.equal(transcoderFeeShare, 10, "wrong transcoderFeeShare");
    }

    function test_setStake() public {
        fixture.setStake(5000);
        Assert.equal(fixture.getTotalStake(), 5000, "wrong totalStake");
    }

    function test_addToFeePool_no_prevEarningsPool() public {
        uint256 fees = 1000;
        
        // earningsPool.cumulativeFeeFactor == 0
        // prevEarningsPool.cumulativeFeeFactor == 0 
        // prevEarningsPool.cumulativeRewardFactor == 0 
        fixture.addToFeePool(fees);
        uint256 expFeeFactor = MathUtils.percPoints(fees, fixture.getTotalStake());
        Assert.equal(fixture.getCumulativeFeeFactor(), expFeeFactor, "should set cumulativeFeeFactor");
        
        // earningsPool.cumulativeFeeFactor != 0 
        fixture.addToFeePool(fees);
        expFeeFactor = expFeeFactor.add(MathUtils.percPoints(fees, fixture.getTotalStake()));
        Assert.equal(fixture.getCumulativeFeeFactor(), expFeeFactor, "should update cumulativeFeeFactor");
    }

    function test_addToFeePool_prevEarningsPool() public {
        uint256 fees = 200;

        // prevEarningsPool.cumulativeFeeFactor = 2
        // prevEarningsPool.cumulativeRewardFactor = 3
        uint256 prevFeeFactor = 2;
        uint256 prevRewFactor = 3;
        fixture.setPrevPoolEarningsFactors(prevFeeFactor, prevRewFactor);

        // earningsPool.cumulativeFeeFactor == 0
        fixture.addToFeePool(fees);
        uint256 expFeeFactor = prevFeeFactor.add(MathUtils.percOf(prevRewFactor, fees, fixture.getTotalStake()));
        Assert.equal(fixture.getCumulativeFeeFactor(), expFeeFactor, "should update cumulativeFeeFactor");

        // earningsPool.cumulativeFeeFactor != 0 
        fixture.addToFeePool(fees);
        expFeeFactor = expFeeFactor.add(MathUtils.percOf(prevRewFactor, fees, fixture.getTotalStake()));
    }

    function test_addToRewardPool() public {
        uint256 rewards = 1000;

        // prevEarningsPool.cumulativeRewardFactor == 0
        uint256 expRewardFactor = MathUtils.percPoints(1,1).add(MathUtils.percOf(MathUtils.percPoints(1,1), rewards, fixture.getTotalStake()));
        fixture.addToRewardPool(1000);
        Assert.equal(expRewardFactor, fixture.getCumulativeRewardFactor(), "incorrect cumulative reward factor");
   
        // prevEarningsPool.cumulativeRewardFactor != 0
        fixture.setPrevPoolEarningsFactors(0, expRewardFactor);
        expRewardFactor = expRewardFactor.add(MathUtils.percOf(expRewardFactor, rewards, fixture.getTotalStake()));
        fixture.addToRewardPool(1000);
        Assert.equal(expRewardFactor, fixture.getCumulativeRewardFactor(), "incorrect cumulative reward factor");
    }

    function test_claimShare_not_used_in_v2() public {
        (uint256 fees, uint256 rewards) = fixture.claimShare(500, false);
        Assert.equal(fees, 0, "should be 0 as it is no longer used in v2");
        Assert.equal(rewards, 0, "should be 0 as it is no longer used in v2");
        Assert.equal(fixture.getFeePool(), 0, "feePool should be 0");
        Assert.equal(fixture.getRewardPool(), 0, "rewardPool should be 0");
        Assert.equal(fixture.getTranscoderFeePool(), 0, "transcoderRewardPool should be 0");
        Assert.equal(fixture.getTranscoderRewardPool(), 0, "transcoderFeePool should be 0");
        Assert.equal(fixture.getClaimableStake(), 0, "getClaimableStake should be 0");
    }

    function test_feePoolShare_not_used_in_v2() public {
        fixture.addToFeePool(500);
        Assert.equal(fixture.feePoolShare(500, false), 0, "should always return 0 in v2");
    }

    function test_rewardPoolShare_not_used_in_v2() public {
        fixture.addToRewardPool(1000);
        Assert.equal(fixture.rewardPoolShare(500, false), 0, "should always return 0 in v2");
    }

    function test_hasClaimableShares_not_used_in_v2() public {
        fixture.addToRewardPool(1000);
        Assert.equal(fixture.hasClaimableShares(), false, "should always return false in v2");
    }
}