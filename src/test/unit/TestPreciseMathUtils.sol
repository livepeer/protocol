// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "ds-test/test.sol";
import "contracts/libraries/PreciseMathUtils.sol";
import "../interfaces/ICheatCodes.sol";

contract TestPreciseMathUtils is DSTest {
    ICheatCodes public constant CHEATS = ICheatCodes(HEVM_ADDRESS);

    function testValidPerc() public {
        assertTrue(PreciseMathUtils.validPerc(50), "50 should be a valid percentage");
        assertTrue(PreciseMathUtils.validPerc(0), "0 should be a valid percentage");
        assertTrue(PreciseMathUtils.validPerc(10**27), "the max should be a valid percentage");
        assertTrue(!PreciseMathUtils.validPerc(10**27 + 1), "1 more than the max should not be valid percentage");
    }

    function testPercOf1() public {
        assertEq(PreciseMathUtils.percOf(100, 3, 4), 75, "3/4 of 100 should be 75");
        assertEq(PreciseMathUtils.percOf(100, 7, 9), 77, "7/9 of 100 should be 77");
    }

    function testPercOf2() public {
        assertEq(PreciseMathUtils.percOf(100, 3), 0, ".0000000000000000000000003% of 100 is 0");
        assertEq(PreciseMathUtils.percOf(10**27, 1), 1, ".0000000000000000000000001% of 1000000000 is 1");
        assertEq(PreciseMathUtils.percOf(100, 10**27 / 10), 10, "10% of 100 is 10");
    }

    function testPercPoints() public {
        assertEq(
            PreciseMathUtils.percPoints(3, 4),
            750000000000000000000000000,
            "3/4 should convert to valid percentage"
        );
        assertEq(
            PreciseMathUtils.percPoints(100, 300),
            333333333333333333333333333,
            "100/300 should convert to valid percentage"
        );
    }
}
