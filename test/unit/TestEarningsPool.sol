pragma solidity ^0.4.17;

import "../../contracts/test/EarningsPoolFixture.sol";
import "truffle/Assert.sol";


contract TestEarningsPool {
    EarningsPoolFixture fixture;

    function beforeEach() public {
        fixture = new EarningsPoolFixture();
        fixture.init(1000, 500000, 500000);
    }

    function test_init() public {
        var (rewardPool, feePool, totalStake, claimableStake, rewardCut, feeShare) = fixture.getEarningsPool();
        Assert.equal(rewardPool, 0, "wrong rewardPool");
        Assert.equal(feePool, 0, "wrong feePool");
        Assert.equal(totalStake, 1000, "wrong totalStake");
        Assert.equal(claimableStake, 1000, "wrong claimableStake");
        Assert.equal(rewardCut, 500000, "wrong transcoderRewardCut");
        Assert.equal(feeShare, 500000, "wrong transcoderFeeShare");
    }

    function test_claimShare_notTranscoder() public {
        fixture.setFeePool(1000);
        fixture.setRewardPool(1000);
        var (fees, rewards) = fixture.claimShare(500, false);
        Assert.equal(fees, 250, "should claim delegator's share of fee pool");
        Assert.equal(rewards, 250, "should claim delegator's share of reward pool");
        Assert.equal(fixture.getFeePool(), 750, "should decrease fee pool by claimant's share of fees");
        Assert.equal(fixture.getRewardPool(), 750, "should decrease reward pool by claimant's share of rewards");
        Assert.equal(fixture.getClaimableStake(), 500, "should decrease claimable stake by stake of claimant");
    }

    function test_claimShare_isTranscoder() public {
        fixture.setFeePool(1000);
        fixture.setRewardPool(1000);
        var (fees, rewards) = fixture.claimShare(500, true);
        Assert.equal(fees, 750, "should claim transcoder's share of fee pool which includes its share as a delegator");
        Assert.equal(rewards, 750, "should claim transcoder's share of reward pool which includes its share as a delegator");
        Assert.equal(fixture.getFeePool(), 250, "should decrease fee pool by claimant's share of fees");
        Assert.equal(fixture.getRewardPool(), 250, "should decrease reward pool by claimant's share of rewards");
        Assert.equal(fixture.getClaimableStake(), 500, "should decrease claimable stake by stake of claimant");
    }

    function test_claimShares_emptyFeePool_notTranscoder() public {
        fixture.setRewardPool(1000);
        var (fees, rewards) = fixture.claimShare(500, false);
        Assert.equal(fees, 0, "should claim 0 fees when fee pool is empty");
        Assert.equal(rewards, 250, "should claim delegator's share of reward pool");
        Assert.equal(fixture.getRewardPool(), 750, "should decrease reward pool by claimant's share of rewards");
        Assert.equal(fixture.getClaimableStake(), 500, "should decrease claimable stake by stake of claimant");
    }

    function test_claimShares_emptyFeePool_isTranscoder() public {
        fixture.setRewardPool(1000);
        var (fees, rewards) = fixture.claimShare(500, true);
        Assert.equal(fees, 0, "should claim 0 fees when fee pool is empty");
        Assert.equal(rewards, 750, "should claim transcoder's share of reward pool which includes its share as a delegator");
        Assert.equal(fixture.getRewardPool(), 250, "should decrease reward pool by claimant's share of rewards");
        Assert.equal(fixture.getClaimableStake(), 500, "should decrease claimable stake by stake of claimant");
    }

    function test_claimShares_emptyRewardPool_notTranscoder() public {
        fixture.setFeePool(1000);
        var (fees, rewards) = fixture.claimShare(500, false);
        Assert.equal(fees, 250, "should claim delegator's share of fee pool");
        Assert.equal(rewards, 0, "should claim 0 rewards when reward pool is empty");
        Assert.equal(fixture.getFeePool(), 750, "should decrease fee pool by claimant's share of fees");
        Assert.equal(fixture.getClaimableStake(), 500, "should decrease claimable stake by stake of claimant");
    }

    function test_claimShares_emptyRewardPool_isTranscoder() public {
        fixture.setFeePool(1000);
        var (fees, rewards) = fixture.claimShare(500, true);
        Assert.equal(fees, 750, "should claim transcoder's share of fee pool which includes its share as a delegator");
        Assert.equal(rewards, 0, "should claim 0 rewards when reward pool is empty");
        Assert.equal(fixture.getFeePool(), 250, "should decrease fee pool by claimant's share of fees");
        Assert.equal(fixture.getClaimableStake(), 500, "should decrease claimable stake by stake of claimant");
    }

    function test_claimShare_emptyFeeAndRewardPools() public {
        var (fees, rewards) = fixture.claimShare(500, false);
        Assert.equal(fees, 0, "should claim 0 fees when fee pool is empty");
        Assert.equal(rewards, 0, "should claim 0 rewards when reward pool is empty");
        Assert.equal(fixture.getClaimableStake(), 500, "should decrease claimable stake by stake of claimant");
    }

    function test_feePoolShare_noClaimableStake() public {
        fixture.init(0, 0, 0);
        Assert.equal(fixture.feePoolShare(500, false), 0, "should return 0 if no claimble stake");
    }

    function test_feePoolShare_notTranscoder() public {
        fixture.setFeePool(1000);
        Assert.equal(fixture.feePoolShare(500, false), 250, "should return delegator's share of fee pool");
    }

    function test_feePoolShare_isTranscoder() public {
        fixture.setFeePool(1000);
        Assert.equal(fixture.feePoolShare(500, true), 750, "should return transcoder's share of fee pool which includes its share as a delegator");
    }

    function test_rewardPoolShare_noClaimableStake() public {
        fixture.init(0, 0, 0);
        Assert.equal(fixture.rewardPoolShare(500, false), 0, "should return 0 if no claimable stake");
    }

    function test_rewardPoolShare_notTranscoder() public {
        fixture.setRewardPool(1000);
        Assert.equal(fixture.rewardPoolShare(500, false), 250, "should return delegator's share of reward pool");
    }

    function test_rewardPoolShare_isTranscoder() public {
        fixture.setRewardPool(1000);
        Assert.equal(fixture.rewardPoolShare(500, true), 750, "should return transcoder's share of reward pool which includes its share as a delegator");
    }

    function test_hasClaimableShares_nonZeroClaimableStake() public {
        Assert.equal(fixture.hasClaimableShares(), true, "should return true when pool has non-zero claimable stake");
    }

    function test_hasClaimableShares_zeroClaimableStake() public {
        fixture.init(0, 0, 0);
        Assert.equal(fixture.hasClaimableShares(), false, "should return false when pool has zero claimable stake");
    }
}
