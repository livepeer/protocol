// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "ds-test/test.sol";
import "contracts/test/mocks/EarningsPoolFixture.sol";
import "../interfaces/ICheatCodes.sol";

contract TestEarningsPool is DSTest {
    ICheatCodes public constant CHEATS = ICheatCodes(HEVM_ADDRESS);
    EarningsPoolFixture fixture;

    function setUp() public {
        fixture = new EarningsPoolFixture();
        fixture.setStake(1000);
        fixture.setCommission(500000, 500000);
    }

    function testSetCommission() public {
        fixture.setCommission(5, 10);
        uint256 transcoderRewardCut = fixture.getTranscoderRewardCut();
        uint256 transcoderFeeShare = fixture.getTranscoderFeeShare();
        assertEq(transcoderRewardCut, 5, "wrong transcoderRewardCut");
        assertEq(transcoderFeeShare, 10, "wrong transcoderFeeShare");
    }

    function testSetStake() public {
        fixture.setStake(5000);
        uint256 totalStake = fixture.getTotalStake();
        assertEq(totalStake, 5000, "wrong totalStake");
    }
}
