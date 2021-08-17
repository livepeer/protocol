pragma solidity 0.8.4;

import "../utils/MathUtils.sol";
import "./helpers/truffle/Assert.sol";

contract TestMathUtils {
    function test_validPerc() public {
        Assert.equal(MathUtils.validPerc(50), true, "50 should be a valid percentage");
        Assert.equal(MathUtils.validPerc(0), true, "0 should be a valid percentage");
        Assert.equal(MathUtils.validPerc(10**27), true, "the max should be a valid percentage");
        Assert.equal(MathUtils.validPerc(10**27 + 1), false, "1 more than the max should not be valid percentage");
    }

    function test_percOf1() public {
        Assert.equal(MathUtils.percOf(100, 3, 4), 75, "3/4 of 100 should be 75");
        Assert.equal(MathUtils.percOf(100, 7, 9), 77, "7/9 of 100 should be 77");
    }

    function test_percOf2() public {
        Assert.equal(MathUtils.percOf(100, 3), 0, ".0000000000000000000000003% of 100 is 0");
        Assert.equal(MathUtils.percOf(10**27, 1), 1, ".0000000000000000000000001% of 1000000000 is 1");
        Assert.equal(MathUtils.percOf(100, 10**27 / 10), 10, "10% of 100 is 10");
    }

    function test_percPoints() public {
        Assert.equal(MathUtils.percPoints(3, 4), 750000000000000000000000000, "3/4 should convert to valid percentage");
        Assert.equal(
            MathUtils.percPoints(100, 300),
            333333333333333333333333333,
            "100/300 should convert to valid percentage"
        );
    }
}
