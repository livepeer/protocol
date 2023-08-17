// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./helpers/truffle/Assert.sol";
import "./helpers/RevertProxy.sol";
import "./mocks/SortedArraysFixture.sol";

contract TestSortedArrays {
    RevertProxy proxy;
    SortedArraysFixture fixture;

    function beforeAll() public {
        proxy = new RevertProxy();
    }

    function beforeEach() public {
        fixture = new SortedArraysFixture();
    }

    function test_pushSorted_addsElements() public {
        fixture.pushSorted(3);
        Assert.equal(fixture.length(), 1, "incorrect array length");
        Assert.equal(fixture.array(0), 3, "incorrect value in array");

        fixture.pushSorted(4);
        Assert.equal(fixture.length(), 2, "incorrect array length");
        Assert.equal(fixture.array(0), 3, "incorrect value in array");
        Assert.equal(fixture.array(1), 4, "incorrect value in array");
    }

    function test_pushSorted_avoidsDuplicates() public {
        fixture.pushSorted(4);
        Assert.equal(fixture.length(), 1, "incorrect array length");
        Assert.equal(fixture.array(0), 4, "incorrect value in array");

        fixture.pushSorted(4);
        Assert.equal(fixture.length(), 1, "incorrect array length");
    }

    function test_pushSorted_revertsOnDecreasing() public {
        fixture.pushSorted(4);
        Assert.equal(fixture.length(), 1, "incorrect array length");
        Assert.equal(fixture.array(0), 4, "incorrect value in array");

        SortedArraysFixture(address(proxy)).pushSorted(3);
        bool ok = proxy.execute(address(fixture));
        Assert.isFalse(ok, "did not revert");
    }

    function test_findLowerBound_lowerThanElement() public {
        fixture.pushSorted(2);
        fixture.pushSorted(4);
        fixture.pushSorted(7);
        fixture.pushSorted(11);

        Assert.equal(fixture.findLowerBound(3), 0, "found incorrect element");
        Assert.equal(fixture.findLowerBound(6), 1, "found incorrect element");
        Assert.equal(fixture.findLowerBound(10), 2, "found incorrect element");
        Assert.equal(fixture.findLowerBound(15), 3, "found incorrect element");
    }

    function test_findLowerBound_exactElement() public {
        fixture.pushSorted(3);
        fixture.pushSorted(5);
        fixture.pushSorted(8);
        fixture.pushSorted(13);

        Assert.equal(fixture.findLowerBound(3), 0, "found incorrect element");
        Assert.equal(fixture.findLowerBound(5), 1, "found incorrect element");
        Assert.equal(fixture.findLowerBound(8), 2, "found incorrect element");
        Assert.equal(fixture.findLowerBound(13), 3, "found incorrect element");
    }

    function test_findLowerBound_returnsLengthOnEmpty() public {
        Assert.equal(fixture.length(), 0, "incorrect array length");
        Assert.equal(fixture.findLowerBound(3), 0, "incorrect return on empty array");
    }

    function test_findLowerBound_returnsLengthOnNotFound() public {
        fixture.pushSorted(8);
        fixture.pushSorted(13);

        Assert.equal(fixture.findLowerBound(22), 1, "found incorrect element");
        // looking for a value lower than min should return the array length
        Assert.equal(fixture.findLowerBound(5), 2, "incorrect return on not found");
    }
}
