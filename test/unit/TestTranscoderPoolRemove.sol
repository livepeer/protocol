pragma solidity ^0.4.17;

import "../../contracts/test/TranscoderPoolFixture.sol";
import "../../contracts/test/RevertProxy.sol";
import "truffle/Assert.sol";


contract TestTranscoderPoolRemove {
    address[] transcoders = [address(1), address(2), address(3), address(4), address(5), address(6)];
    uint256[] stakes = [uint256(3), uint256(5), uint256(7), uint256(9), uint256(11), uint256(13)];

    TranscoderPoolFixture fixture;
    RevertProxy proxy;

    function beforeAll() public {
        proxy = new RevertProxy();
    }

    function beforeEach() public {
        fixture = new TranscoderPoolFixture();
        fixture.setMaxSize(10);
    }

    function test_remove() public {
        fixture.addTranscoder(transcoders[0], stakes[0], address(0), address(0));
        fixture.addTranscoder(transcoders[1], stakes[1], transcoders[0], address(0));
        fixture.addTranscoder(transcoders[2], stakes[2], transcoders[1], address(0));

        fixture.removeTranscoder(transcoders[1]);
        Assert.equal(fixture.contains(transcoders[1]), false, "should not contain transcoder");
        Assert.equal(fixture.getSize(), 2, "wrong size");
        Assert.equal(fixture.getNextTranscoder(transcoders[0]), transcoders[2], "wrong next transcoder");
        Assert.equal(fixture.getPrevTranscoder(transcoders[2]), transcoders[0], "wrong prev transcoder");
    }

    function test_remove_notInPool() public {
        fixture.addTranscoder(transcoders[0], stakes[0], address(0), address(0));

        TranscoderPoolFixture(address(proxy)).removeTranscoder(transcoders[1]);
        bool result = proxy.execute(address(fixture));
        Assert.isFalse(result, "did not revert");
    }
}
