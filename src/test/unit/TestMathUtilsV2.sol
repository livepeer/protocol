// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "ds-test/test.sol";
import "contracts/libraries/MathUtilsV2.sol";
import "../interfaces/ICheatCodes.sol";

contract TestMathUtilsV2 is DSTest {
    ICheatCodes public constant CHEATS = ICheatCodes(HEVM_ADDRESS);

    function testValidPerc() public {
        assertTrue(MathUtils.validPerc(50), "50 should be a valid percentage");
        assertTrue(MathUtils.validPerc(0), "0 should be a valid percentage");
        assertTrue(MathUtils.validPerc(1000000000), "the max should be a valid percentage");
        assertTrue(!MathUtils.validPerc(1000000001), "1 more than the max should not be valid percentage");
    }

    function testPercOf1() public {
        assertEq(MathUtils.percOf(100, 3, 4), 75, "3/4 of 100 should be 75");
        assertEq(MathUtils.percOf(100, 7, 9), 77, "7/9 of 100 should be 77");
    }

    function testPercOf2() public {
        assertEq(MathUtils.percOf(100, 3), 0, ".0000003% of 100 is 0");
        assertEq(MathUtils.percOf(1000000000, 1), 1, ".0000001% of 1000000000 is 1");
        assertEq(MathUtils.percOf(100, 100000000), 10, "10% of 100 is 10");
    }

    function testPercPoints() public {
        assertEq(MathUtils.percPoints(3, 4), 750000000, "3/4 should convert to valid percentage");
        assertEq(MathUtils.percPoints(100, 300), 333333333, "100/300 should convert to valid percentage");
    }
}
