pragma solidity ^0.5.11;

import "./mocks/EarningsPoolFixture.sol";
import "./helpers/truffle/Assert.sol";

contract TestEarningsPool2 {
    EarningsPoolFixture fixture;

    function beforeEach() public {
        fixture = new EarningsPoolFixture();
        fixture.setStake(1000);
        fixture.setClaimableStake(1000);
        fixture.setCommission(500000, 500000);
        fixture.setHasTranscoderRewardFeePool(true);
    }

    function test_feePoolShare_noClaimableStake() public {
        fixture.setStake(0);
        fixture.setClaimableStake(0);
        fixture.setCommission(0, 0);
        Assert.equal(fixture.feePoolShare(500, false), 0, "should return 0 if no claimable stake");
    }

    function test_feePoolShare_notTranscoder() public {
        fixture.addToFeePool(1000);
        Assert.equal(fixture.feePoolShare(500, false), 250, "should return delegator's share of fee pool");
    }

    function test_feePoolShare_isTranscoder() public {
        fixture.addToFeePool(1000);
        Assert.equal(
            fixture.feePoolShare(500, true),
            750,
            "should return transcoder's share of fee pool which includes its share as a delegator"
        );
    }

    function test_rewardPoolShare_noClaimableStake() public {
        fixture.setStake(0);
        fixture.setClaimableStake(0);
        fixture.setCommission(0, 0);
        Assert.equal(fixture.rewardPoolShare(500, false), 0, "should return 0 if no claimable stake");
    }

    function test_rewardPoolShare_notTranscoder() public {
        fixture.addToRewardPool(1000);
        Assert.equal(fixture.rewardPoolShare(500, false), 250, "should return delegator's share of reward pool");
    }

    function test_rewardPoolShare_isTranscoder() public {
        fixture.addToRewardPool(1000);
        Assert.equal(
            fixture.rewardPoolShare(500, true),
            750,
            "should return transcoder's share of reward pool which includes its share as a delegator"
        );
    }

    function test_hasClaimableShares_nonZeroClaimableStake() public {
        Assert.equal(fixture.hasClaimableShares(), true, "should return true when pool has non-zero claimable stake");
    }

    function test_hasClaimableShares_zeroClaimableStake() public {
        fixture.setStake(0);
        fixture.setClaimableStake(0);
        fixture.setCommission(0, 0);
        Assert.equal(fixture.hasClaimableShares(), false, "should return false when pool has zero claimable stake");
    }
}
