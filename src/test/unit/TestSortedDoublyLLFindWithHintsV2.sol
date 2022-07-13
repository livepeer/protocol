// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "ds-test/test.sol";
import "contracts/test/mocks/SortedDoublyLLFixture.sol";
import "../interfaces/ICheatCodes.sol";

contract TestSortedDoublyLLFindWithHintsV2 is DSTest {
    ICheatCodes public constant CHEATS = ICheatCodes(HEVM_ADDRESS);

    address[] ids = [address(1), address(2), address(3), address(4), address(5), address(6)];
    uint256[] keys = [uint256(13), uint256(11), uint256(9), uint256(7), uint256(5), uint256(3)];

    SortedDoublyLLFixture fixture;

    function setUp() public {
        fixture = new SortedDoublyLLFixture();
        fixture.setMaxSize(10);
    }

    function testInsertFindWithHintPrevRemoved() public {
        fixture.insert(ids[0], keys[0], address(0), address(0));
        fixture.insert(ids[1], keys[1], ids[0], address(0));
        fixture.insert(ids[2], keys[2], ids[1], address(0));
        fixture.insert(ids[4], keys[4], ids[2], address(0));
        fixture.insert(ids[5], keys[5], ids[4], address(0));

        fixture.remove(ids[2]);
        fixture.insert(ids[3], keys[3], ids[2], ids[4]);
        assertEq(fixture.getSize(), 5, "wrong size");
        assertEq(fixture.getKey(ids[3]), keys[3], "wrong key");
        assertEq(fixture.getNext(ids[3]), ids[4], "wrong next");
        assertEq(fixture.getPrev(ids[3]), ids[1], "wrong prev");
    }

    function testInsertFindWithHintPrevRemovedUpdateHead() public {
        fixture.insert(ids[0], keys[0], address(0), address(0));
        fixture.insert(ids[2], keys[2], ids[1], address(0));
        fixture.insert(ids[3], keys[3], ids[2], address(0));
        fixture.insert(ids[4], keys[4], ids[3], address(0));
        fixture.insert(ids[5], keys[5], ids[4], address(0));

        fixture.remove(ids[0]);
        fixture.insert(ids[1], keys[1], ids[0], ids[2]);
        assertEq(fixture.getSize(), 5, "wrong size");
        assertEq(fixture.getFirst(), ids[1], "wrong head");
        assertEq(fixture.getKey(ids[1]), keys[1], "wrong key");
        assertEq(fixture.getNext(ids[1]), ids[2], "wrong next");
        assertEq(fixture.getPrev(ids[1]), address(0), "wrong prev");
    }

    function testInsertFindWithHintPrevDecreased() public {
        fixture.insert(ids[0], keys[0], address(0), address(0));
        fixture.insert(ids[1], keys[1], ids[0], address(0));
        fixture.insert(ids[2], keys[2], ids[1], address(0));
        fixture.insert(ids[4], keys[4], ids[2], address(0));
        fixture.insert(ids[5], keys[5], ids[4], address(0));

        fixture.updateKey(ids[2], 6, address(0), address(0));
        fixture.insert(ids[3], keys[3], ids[2], ids[4]);
        assertEq(fixture.getSize(), 6, "wrong size");
        assertEq(fixture.getKey(ids[3]), keys[3], "wrong key");
        assertEq(fixture.getNext(ids[3]), ids[2], "wrong next");
        assertEq(fixture.getPrev(ids[3]), ids[1], "wrong prev");
    }

    function testInsertWithFindWithHintNextRemoved() public {
        fixture.insert(ids[0], keys[0], address(0), address(0));
        fixture.insert(ids[1], keys[1], ids[0], address(0));
        fixture.insert(ids[2], keys[2], ids[1], address(0));
        fixture.insert(ids[4], keys[4], ids[2], address(0));
        fixture.insert(ids[5], keys[5], ids[4], address(0));

        fixture.remove(ids[4]);
        fixture.insert(ids[3], keys[3], ids[2], ids[4]);
        assertEq(fixture.getSize(), 5, "wrong size");
        assertEq(fixture.getKey(ids[3]), keys[3], "wrong key");
        assertEq(fixture.getNext(ids[3]), ids[5], "wrong next");
        assertEq(fixture.getPrev(ids[3]), ids[2], "wrong prev");
    }

    function testInsertWithFindWithHintNextRemovedUpdateTail() public {
        fixture.insert(ids[0], keys[0], address(0), address(0));
        fixture.insert(ids[1], keys[1], ids[0], address(0));
        fixture.insert(ids[2], keys[2], ids[1], address(0));
        fixture.insert(ids[3], keys[3], ids[2], address(0));
        fixture.insert(ids[5], keys[5], ids[3], address(0));

        fixture.remove(ids[5]);
        fixture.insert(ids[4], keys[4], ids[3], ids[5]);
        assertEq(fixture.getSize(), 5, "wrong size");
        assertEq(fixture.getLast(), ids[4], "wrong tail");
        assertEq(fixture.getKey(ids[4]), keys[4], "wrong key");
        assertEq(fixture.getNext(ids[4]), address(0), "wrong next");
        assertEq(fixture.getPrev(ids[4]), ids[3], "wrong prev");
    }

    function testInsertWithfindWithHintNextIncreased() public {
        fixture.insert(ids[0], keys[0], address(0), address(0));
        fixture.insert(ids[1], keys[1], ids[0], address(0));
        fixture.insert(ids[2], keys[2], ids[1], address(0));
        fixture.insert(ids[4], keys[4], ids[2], address(0));
        fixture.insert(ids[5], keys[5], ids[4], address(0));

        fixture.updateKey(ids[4], 8, address(0), address(0));
        fixture.insert(ids[3], keys[3], ids[2], ids[4]);
        assertEq(fixture.getSize(), 6, "wrong size");
        assertEq(fixture.getKey(ids[3]), keys[3], "wrong key");
        assertEq(fixture.getNext(ids[3]), ids[5], "wrong next");
        assertEq(fixture.getPrev(ids[3]), ids[4], "wrong prev");
    }

    function testInsertWithFindWithHintNotTightBound() public {
        fixture.insert(ids[0], keys[0], address(0), address(0));
        fixture.insert(ids[1], keys[1], ids[0], address(0));
        fixture.insert(ids[2], keys[2], ids[1], address(0));
        fixture.insert(ids[4], keys[4], ids[2], address(0));
        fixture.insert(ids[5], keys[5], ids[4], address(0));

        fixture.insert(ids[3], keys[3], ids[0], ids[5]);
        assertEq(fixture.getSize(), 6, "wrong size");
        assertEq(fixture.getKey(ids[3]), keys[3], "wrong key");
        assertEq(fixture.getNext(ids[3]), ids[4], "wrong next");
        assertEq(fixture.getPrev(ids[3]), ids[2], "wrong prev");
    }
}
