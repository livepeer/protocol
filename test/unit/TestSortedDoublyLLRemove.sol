pragma solidity ^0.4.17;

import "../../contracts/test/SortedDoublyLLFixture.sol";
import "../../contracts/test/RevertProxy.sol";
import "truffle/Assert.sol";


contract TestSortedDoublyLLRemove {
    address[] ids = [address(1), address(2), address(3), address(4), address(5), address(6)];
    uint256[] keys = [uint256(13), uint256(11), uint256(9), uint256(7), uint256(5), uint256(3)];

    SortedDoublyLLFixture fixture;
    RevertProxy proxy;

    function beforeAll() public {
        proxy = new RevertProxy();
    }

    function beforeEach() public {
        fixture = new SortedDoublyLLFixture();
        fixture.setMaxSize(10);
    }

    function test_remove() public {
        fixture.insert(ids[0], keys[0], address(0), address(0));
        fixture.insert(ids[1], keys[1], ids[0], address(0));
        fixture.insert(ids[2], keys[2], ids[1], address(0));

        fixture.remove(ids[1]);
        Assert.equal(fixture.contains(ids[1]), false, "should not contain node");
        Assert.equal(fixture.getSize(), 2, "wrong size");
        Assert.equal(fixture.getNext(ids[0]), ids[2], "wrong next");
        Assert.equal(fixture.getPrev(ids[2]), ids[0], "wrong prev");
    }

    function test_remove_notInList() public {
        fixture.insert(ids[0], keys[0], address(0), address(0));

        SortedDoublyLLFixture(address(proxy)).remove(ids[1]);
        bool result = proxy.execute(address(fixture));
        Assert.isFalse(result, "did not revert");
    }
}
