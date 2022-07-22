// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "ds-test/test.sol";
import "contracts/test/mocks/SortedDoublyLLFixture.sol";
import "../helpers/RevertProxy.sol";
import "../interfaces/ICheatCodes.sol";

contract TestSortedDoublyLLInsert is DSTest {
    ICheatCodes public constant CHEATS = ICheatCodes(HEVM_ADDRESS);

    address[] ids = [address(1), address(2), address(3), address(4), address(5), address(6)];
    uint256[] keys = [uint256(13), uint256(11), uint256(9), uint256(7), uint256(5), uint256(5), uint256(3)];

    SortedDoublyLLFixture fixture;
    RevertProxy proxy;

    function setUp() public {
        proxy = new RevertProxy();
        fixture = new SortedDoublyLLFixture();
        fixture.setMaxSize(3);
    }

    function testSetMaxSize() public {
        assertEq(fixture.getMaxSize(), 3, "wrong max size");
    }

    function testSetMaxSizeUpdate() public {
        fixture.setMaxSize(10);

        assertEq(fixture.getMaxSize(), 10, "wrong max size");
    }

    function testSetMaxSizeDecreaseSize() public {
        SortedDoublyLLFixture(address(proxy)).setMaxSize(1);
        bool result = proxy.execute(address(fixture));
        assertTrue(!result, "did not revert");
    }

    function testInsertEmpty() public {
        fixture.insert(ids[0], keys[0], address(0), address(0));
        assertEq(fixture.getSize(), 1, "wrong size");
        assertEq(fixture.getFirst(), ids[0], "wrong head");
        assertEq(fixture.getLast(), ids[0], "wrong tail");
        assertEq(fixture.getKey(ids[0]), keys[0], "wrong key");
        assertEq(fixture.getNext(ids[0]), address(0), "wrong next");
        assertEq(fixture.getPrev(ids[0]), address(0), "wrong prev");
    }

    function testInsertUpdateHead() public {
        fixture.insert(ids[1], keys[1], address(0), address(0));

        fixture.insert(ids[0], keys[0], address(0), ids[1]);
        assertEq(fixture.getSize(), 2, "wrong size");
        assertEq(fixture.getFirst(), ids[0], "wrong head");
        assertEq(fixture.getKey(ids[0]), keys[0], "wrong key");
        assertEq(fixture.getNext(ids[0]), ids[1], "wrong next");
        assertEq(fixture.getPrev(ids[0]), address(0), "wrong prev");
    }

    function testInsertUpdateTail() public {
        fixture.insert(ids[0], keys[0], address(0), address(0));

        fixture.insert(ids[1], keys[1], ids[0], address(0));
        assertEq(fixture.getSize(), 2, "wrong size");
        assertEq(fixture.getLast(), ids[1], "wrong tail");
        assertEq(fixture.getKey(ids[1]), keys[1], "wrong key");
        assertEq(fixture.getNext(ids[1]), address(0), "wrong next");
        assertEq(fixture.getPrev(ids[1]), ids[0], "wrong prev");
    }

    function testInsertAtPosition() public {
        fixture.insert(ids[0], keys[0], address(0), address(0));
        fixture.insert(ids[2], keys[2], ids[0], address(0));

        fixture.insert(ids[1], keys[1], ids[0], ids[2]);
        assertEq(fixture.getSize(), 3, "wrong size");
        assertEq(fixture.getKey(ids[1]), keys[1], "wrong stake");
        assertEq(fixture.getNext(ids[1]), ids[2], "wrong next transcoder");
        assertEq(fixture.getPrev(ids[1]), ids[0], "wrong prev transcoder");
    }

    function testInsertFull() public {
        fixture.insert(ids[0], keys[0], address(0), address(0));
        fixture.insert(ids[1], keys[1], ids[0], address(0));
        fixture.insert(ids[2], keys[2], ids[1], address(0));

        SortedDoublyLLFixture(address(proxy)).insert(ids[3], keys[3], address(0), address(0));
        bool result = proxy.execute(address(fixture));
        assertTrue(!result, "did not revert");
    }

    function testInsertContainsId() public {
        fixture.insert(ids[0], keys[0], address(0), address(0));

        SortedDoublyLLFixture(address(proxy)).insert(ids[0], keys[0], address(0), address(0));
        bool result = proxy.execute(address(fixture));
        assertTrue(!result, "did not revert");
    }

    function testInsertNull() public {
        SortedDoublyLLFixture(address(proxy)).insert(address(0), keys[0], address(0), address(0));
        bool result = proxy.execute(address(fixture));
        assertTrue(!result, "did not revert");
    }

    function testInsertZeroKey() public {
        SortedDoublyLLFixture(address(proxy)).insert(ids[0], 0, address(0), address(0));
        bool result = proxy.execute(address(fixture));
        assertTrue(!result, "did not revert");
    }
}
