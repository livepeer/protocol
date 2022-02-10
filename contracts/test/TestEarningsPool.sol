// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./mocks/EarningsPoolFixture.sol";
import "./helpers/truffle/Assert.sol";

contract TestEarningsPool {
    EarningsPoolFixture fixture;

    function beforeEach() public {
        fixture = new EarningsPoolFixture();
        fixture.setStake(1000);
        fixture.setCommission(500000, 500000);
    }

    function test_setCommission() public {
        fixture.setCommission(5, 10);
        uint256 transcoderRewardCut = fixture.getTranscoderRewardCut();
        uint256 transcoderFeeShare = fixture.getTranscoderFeeShare();
        Assert.equal(transcoderRewardCut, 5, "wrong transcoderRewardCut");
        Assert.equal(transcoderFeeShare, 10, "wrong transcoderFeeShare");
    }

    function test_setStake() public {
        fixture.setStake(5000);
        uint256 totalStake = fixture.getTotalStake();
        Assert.equal(totalStake, 5000, "wrong totalStake");
    }
}
