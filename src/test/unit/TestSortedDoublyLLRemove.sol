// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "ds-test/test.sol";
import "../interfaces/ICheatCodes.sol";
import "contracts/test/mocks/SortedDoublyLLFixture.sol";
import "contracts/test/helpers/RevertProxy.sol";

contract TestSortedDoublyLLRemove is DSTest {
    ICheatCodes public constant CHEATS = ICheatCodes(HEVM_ADDRESS);

    address[] ids = [address(1), address(2), address(3), address(4), address(5), address(6)];
    uint256[] keys = [uint256(13), uint256(11), uint256(9), uint256(7), uint256(5), uint256(3)];

    SortedDoublyLLFixture fixture;
    RevertProxy proxy;

    function setUp() public {
        proxy = new RevertProxy();
        fixture = new SortedDoublyLLFixture();
        fixture.setMaxSize(10);
    }

    function testRemove() public {
        fixture.insert(ids[0], keys[0], address(0), address(0));
        fixture.insert(ids[1], keys[1], ids[0], address(0));
        fixture.insert(ids[2], keys[2], ids[1], address(0));

        fixture.remove(ids[1]);

        assertTrue(!fixture.contains(ids[1]), "should not contain node");
        assertEq(fixture.getSize(), 2, "wrong size");
        assertEq(fixture.getNext(ids[0]), ids[2], "wrong next");
        assertEq(fixture.getPrev(ids[2]), ids[0], "wrong prev");
    }

    function testRemoveSingleNode() public {
        fixture.insert(ids[0], keys[0], address(0), address(0));

        fixture.remove(ids[0]);

        assertTrue(!fixture.contains(ids[0]), "should not contain node");
        assertEq(fixture.getSize(), 0, "wrong size");
        assertEq(fixture.getFirst(), address(0), "wrong head");
        assertEq(fixture.getLast(), address(0), "wrong tail");
    }

    function testRemoveHead() public {
        fixture.insert(ids[0], keys[0], address(0), address(0));
        fixture.insert(ids[1], keys[1], ids[0], address(0));

        fixture.remove(ids[0]);

        assertTrue(!fixture.contains(ids[0]), "should not contain node");
        assertEq(fixture.getSize(), 1, "wrong size");
        assertEq(fixture.getFirst(), ids[1], "wrong head");
        assertEq(fixture.getPrev(ids[1]), address(0), "wrong prev");
    }

    function testRemoveTail() public {
        fixture.insert(ids[0], keys[0], address(0), address(0));
        fixture.insert(ids[1], keys[1], ids[0], address(0));

        fixture.remove(ids[1]);

        assertTrue(!fixture.contains(ids[1]), "should not contain node");
        assertEq(fixture.getSize(), 1, "wrong size");
        assertEq(fixture.getLast(), ids[0], "wrong prev");
        assertEq(fixture.getNext(ids[0]), address(0), "wrong next");
    }

    function testRemoveNotInList() public {
        fixture.insert(ids[0], keys[0], address(0), address(0));

        SortedDoublyLLFixture(address(proxy)).remove(ids[1]);
        bool result = proxy.execute(address(fixture));
        assertTrue(!result, "did not revert");
    }
}
