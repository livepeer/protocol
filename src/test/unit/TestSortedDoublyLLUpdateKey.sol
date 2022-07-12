// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "ds-test/test.sol";
import "../interfaces/ICheatCodes.sol";
import "contracts/test/mocks/SortedDoublyLLFixture.sol";
import "contracts/test/helpers/RevertProxy.sol";

contract TestSortedDoublyLLUpdateKey is DSTest {
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

    function testUpdateKeyMissingId() public {
        SortedDoublyLLFixture(address(proxy)).updateKey(ids[3], 5, address(0), address(0));
        bool result = proxy.execute(address(fixture));
        assertTrue(!result, "did not revert");
    }

    function testUpdateKeyIncreaseNoHint() public {
        fixture.insert(ids[0], keys[0], address(0), address(0));
        fixture.insert(ids[1], keys[1], ids[0], address(0));
        fixture.insert(ids[2], keys[2], ids[1], address(0));
        fixture.insert(ids[3], keys[3], ids[2], address(0));
        fixture.insert(ids[4], keys[4], ids[3], address(0));
        fixture.insert(ids[5], keys[5], ids[4], address(0));

        uint256 newKey = keys[3] + 3;
        fixture.updateKey(ids[3], newKey, address(0), address(0));
        assertEq(fixture.getKey(ids[3]), newKey, "wrong key");
        assertEq(fixture.getNext(ids[3]), ids[2], "wrong next");
        assertEq(fixture.getPrev(ids[3]), ids[1], "wrong prev");
        assertEq(fixture.getNext(ids[1]), ids[3], "wrong next");
        assertEq(fixture.getPrev(ids[2]), ids[3], "wrong prev");
    }

    function testUpdateKeyDecreaseNoHint() public {
        fixture.insert(ids[0], keys[0], address(0), address(0));
        fixture.insert(ids[1], keys[1], ids[0], address(0));
        fixture.insert(ids[2], keys[2], ids[1], address(0));
        fixture.insert(ids[3], keys[3], ids[2], address(0));
        fixture.insert(ids[4], keys[4], ids[3], address(0));
        fixture.insert(ids[5], keys[5], ids[4], address(0));

        uint256 newKey = keys[3] - 3;
        fixture.updateKey(ids[3], newKey, address(0), address(0));
        assertEq(fixture.getKey(ids[3]), newKey, "wrong key");
        assertEq(fixture.getNext(ids[3]), ids[5], "wrong next");
        assertEq(fixture.getPrev(ids[3]), ids[4], "wrong prev");
        assertEq(fixture.getNext(ids[4]), ids[3], "wrong next");
        assertEq(fixture.getPrev(ids[5]), ids[3], "wrong prev");
    }

    function testUpdateKeyZeroNewKey() public {
        fixture.insert(ids[0], keys[0], address(0), address(0));
        fixture.insert(ids[1], keys[1], ids[0], address(0));
        fixture.insert(ids[2], keys[2], ids[1], address(0));

        uint256 newKey = 10;
        fixture.updateKey(ids[2], newKey, address(0), address(0));
        assertTrue(fixture.contains(ids[2]), "list should not contain id after updating with newKey = 0");
    }
}