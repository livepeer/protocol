pragma solidity ^0.4.17;

import "../../contracts/test/EarningsPoolFixture.sol";
import "truffle/Assert.sol";


contract TestEarningsPoolNoTranscoderRewardFeePool {
    EarningsPoolFixture fixture;

    function beforeEach() public {
        fixture = new EarningsPoolFixture();
        fixture.init(1000, 500000, 500000);
        fixture.setHasTranscoderRewardFeePool(false);
    }

    function test_hasTranscoderRewardFeePool() public {
        Assert.equal(fixture.getHasTranscoderRewardFeePool(), false, "wrong hasTranscoderRewardFeePool");
    }

    function test_addToFeePool() public {
        fixture.addToFeePool(1000);
        Assert.equal(fixture.getFeePool(), 1000, "should put all fees in delegator fee pool");
        Assert.equal(fixture.getTranscoderFeePool(), 0, "should put 0 fees in transcoder fee pool");
    }

    function test_addToFeePool_zero() public {
        fixture.addToFeePool(0);
        Assert.equal(fixture.getFeePool(), 0, "should put 0 fees in delegator fee pool");
        Assert.equal(fixture.getTranscoderFeePool(), 0, "should put 0 fees in transcoder fee pool");
    }

    function test_addToRewardPool() public {
        fixture.addToRewardPool(1000);
        Assert.equal(fixture.getRewardPool(), 1000, "should put all rewards in delegator reward pool");
        Assert.equal(fixture.getTranscoderRewardPool(), 0, "should put 0 rewards in transcoder reward pool");
    }

    function test_addToRewardPool_zero() public {
        fixture.addToRewardPool(0);
        Assert.equal(fixture.getRewardPool(), 0, "should put 0 rewards in delegator reward pool");
        Assert.equal(fixture.getTranscoderRewardPool(), 0, "should put 0 rewards in transcoder reward pool");
    }

    function test_claimShare_notTranscoder() public {
        fixture.addToFeePool(1000);
        fixture.addToRewardPool(1000);
        var (fees, rewards) = fixture.claimShare(500, false);
        Assert.equal(fees, 250, "should claim delegator's share of fee pool");
        Assert.equal(rewards, 250, "should claim delegator's share of reward pool");
        Assert.equal(fixture.getFeePool(), 750, "should decrease fee pool by claimant's share of fees");
        Assert.equal(fixture.getRewardPool(), 750, "should decrease reward pool by claimant's share of rewards");
        Assert.equal(fixture.getTranscoderFeePool(), 0, "transcoderFeePool should remain 0");
        Assert.equal(fixture.getTranscoderRewardPool(), 0, "transcoderRewardPool should remain 0");
        Assert.equal(fixture.getClaimableStake(), 500, "should decrease claimable stake by stake of claimant");
    }

    function test_claimShare_isTranscoder() public {
        fixture.addToFeePool(1000);
        fixture.addToRewardPool(1000);
        var (fees, rewards) = fixture.claimShare(500, true);
        Assert.equal(fees, 750, "should claim transcoder's share of fee pool which includes its share as a delegator");
        Assert.equal(rewards, 750, "should claim transcoder's share of reward pool which includes its share as a delegator");
        Assert.equal(fixture.getFeePool(), 250, "should decrease fee pool by claimant's share of fees");
        Assert.equal(fixture.getRewardPool(), 250, "should decrease reward pool by claimant's share of rewards");
        Assert.equal(fixture.getTranscoderFeePool(), 0, "transcoderFeePool should remain 0");
        Assert.equal(fixture.getTranscoderRewardPool(), 0, "transcoderRewardPool should remain 0");
        Assert.equal(fixture.getClaimableStake(), 500, "should decrease claimable stake by stake of claimant");
    }

    function test_claimShares_emptyFeePool_notTranscoder() public {
        fixture.addToRewardPool(1000);
        var (fees, rewards) = fixture.claimShare(500, false);
        Assert.equal(fees, 0, "should claim 0 fees when fee pool is empty");
        Assert.equal(rewards, 250, "should claim delegator's share of reward pool");
        Assert.equal(fixture.getRewardPool(), 750, "should decrease reward pool by claimant's share of rewards");
        Assert.equal(fixture.getTranscoderRewardPool(), 0, "transcoderRewardPool should remain 0");
        Assert.equal(fixture.getClaimableStake(), 500, "should decrease claimable stake by stake of claimant");
    }

    function test_claimShares_emptyFeePool_isTranscoder() public {
        fixture.addToRewardPool(1000);
        var (fees, rewards) = fixture.claimShare(500, true);
        Assert.equal(fees, 0, "should claim 0 fees when fee pool is empty");
        Assert.equal(rewards, 750, "should claim transcoder's share of reward pool which includes its share as a delegator");
        Assert.equal(fixture.getRewardPool(), 250, "should decrease reward pool by claimant's share of rewards");
        Assert.equal(fixture.getTranscoderRewardPool(), 0, "transcoderRewardPool should remain 0");
        Assert.equal(fixture.getClaimableStake(), 500, "should decrease claimable stake by stake of claimant");
    }

    function test_claimShares_emptyRewardPool_notTranscoder() public {
        fixture.addToFeePool(1000);
        var (fees, rewards) = fixture.claimShare(500, false);
        Assert.equal(fees, 250, "should claim delegator's share of fee pool");
        Assert.equal(rewards, 0, "should claim 0 rewards when reward pool is empty");
        Assert.equal(fixture.getFeePool(), 750, "should decrease fee pool by claimant's share of fees");
        Assert.equal(fixture.getTranscoderFeePool(), 0, "transcoderFeePool should remain 0");
        Assert.equal(fixture.getClaimableStake(), 500, "should decrease claimable stake by stake of claimant");
    }

    function test_claimShares_emptyRewardPool_isTranscoder() public {
        fixture.addToFeePool(1000);
        var (fees, rewards) = fixture.claimShare(500, true);
        Assert.equal(fees, 750, "should claim transcoder's share of fee pool which includes its share as a delegator");
        Assert.equal(rewards, 0, "should claim 0 rewards when reward pool is empty");
        Assert.equal(fixture.getFeePool(), 250, "should decrease fee pool by claimant's share of fees");
        Assert.equal(fixture.getTranscoderFeePool(), 0, "transcoderFeePool should remain 0");
        Assert.equal(fixture.getClaimableStake(), 500, "should decrease claimable stake by stake of claimant");
    }

    function test_claimShare_emptyFeeAndRewardPools() public {
        var (fees, rewards) = fixture.claimShare(500, false);
        Assert.equal(fees, 0, "should claim 0 fees when fee pool is empty");
        Assert.equal(rewards, 0, "should claim 0 rewards when reward pool is empty");
        Assert.equal(fixture.getFeePool(), 0, "feePool should remain 0");
        Assert.equal(fixture.getRewardPool(), 0, "rewardPool should remain 0");
        Assert.equal(fixture.getTranscoderFeePool(), 0, "transcoderRewardPool should remain 0");
        Assert.equal(fixture.getTranscoderRewardPool(), 0, "transcoderFeePool should remain 0");
        Assert.equal(fixture.getClaimableStake(), 500, "should decrease claimable stake by stake of claimant");
    }

    function test_feePoolShare_noClaimableStake() public {
        fixture.init(0, 0, 0);
        fixture.setHasTranscoderRewardFeePool(false);
        Assert.equal(fixture.feePoolShare(500, false), 0, "should return 0 if no claimable stake");
    }

    function test_feePoolShare_notTranscoder() public {
        fixture.addToFeePool(1000);
        Assert.equal(fixture.feePoolShare(500, false), 250, "should return delegator's share of fee pool");
    }

    function test_feePoolShare_isTranscoder() public {
        fixture.addToFeePool(1000);
        Assert.equal(fixture.feePoolShare(500, true), 750, "should return transcoder's share of fee pool which includes its share as a delegator");
    }

    function test_rewardPoolShare_noClaimableStake() public {
        fixture.init(0, 0, 0);
        fixture.setHasTranscoderRewardFeePool(false);
        Assert.equal(fixture.rewardPoolShare(500, false), 0, "should return 0 if no claimable stake");
    }

    function test_rewardPoolShare_notTranscoder() public {
        fixture.addToRewardPool(1000);
        Assert.equal(fixture.rewardPoolShare(500, false), 250, "should return delegator's share of reward pool");
    }

    function test_rewardPoolShare_isTranscoder() public {
        fixture.addToRewardPool(1000);
        Assert.equal(fixture.rewardPoolShare(500, true), 750, "should return transcoder's share of reward pool which includes its share as a delegator");
    }

    function test_hasClaimableShares_nonZeroClaimableStake() public {
        Assert.equal(fixture.hasClaimableShares(), true, "should return true when pool has non-zero claimable stake");
    }

    function test_hasClaimableShares_zeroClaimableStake() public {
        fixture.init(0, 0, 0);
        fixture.setHasTranscoderRewardFeePool(false);
        Assert.equal(fixture.hasClaimableShares(), false, "should return false when pool has zero claimable stake");
    }
}
