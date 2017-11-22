pragma solidity ^0.4.17;

import "../../contracts/test/TranscoderPoolFixture.sol";
import "../../contracts/test/RevertProxy.sol";
import "truffle/Assert.sol";


contract TestTranscoderPoolAdd {
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

    function test_setMaxSize() public {
        Assert.equal(fixture.getMaxSize(), 10, "wrong max size");
    }

    function test_addTranscoder_emptyPool() public {
        fixture.addTranscoder(transcoders[0], stakes[0], address(0), address(0));
        Assert.equal(fixture.getSize(), 1, "wrong size");
        Assert.equal(fixture.getWorstTranscoder(), transcoders[0], "wrong head");
        Assert.equal(fixture.getBestTranscoder(), transcoders[0], "wrong tail");
        Assert.equal(fixture.getTranscoderStake(transcoders[0]), stakes[0], "wrong stake");
        Assert.equal(fixture.getNextTranscoder(transcoders[0]), address(0), "wrong next transcoder");
        Assert.equal(fixture.getPrevTranscoder(transcoders[0]), address(0), "wrong prev transcoder");
    }

    function test_addTranscoder_updateHead() public {
        fixture.addTranscoder(transcoders[1], stakes[1], address(0), address(0));

        fixture.addTranscoder(transcoders[0], stakes[0], address(0), transcoders[1]);
        Assert.equal(fixture.getSize(), 2, "wrong size");
        Assert.equal(fixture.getWorstTranscoder(), transcoders[0], "wrong head");
        Assert.equal(fixture.getTranscoderStake(transcoders[0]), stakes[0], "wrong stake");
        Assert.equal(fixture.getNextTranscoder(transcoders[0]), transcoders[1], "wrong next transcoder");
        Assert.equal(fixture.getPrevTranscoder(transcoders[0]), address(0), "wrong prev transcoder");
    }

    function test_addTranscoder_updateTail() public {
        fixture.addTranscoder(transcoders[0], stakes[0], address(0), address(0));

        fixture.addTranscoder(transcoders[1], stakes[1], transcoders[0], address(0));
        Assert.equal(fixture.getSize(), 2, "wrong size");
        Assert.equal(fixture.getBestTranscoder(), transcoders[1], "wrong tail");
        Assert.equal(fixture.getTranscoderStake(transcoders[1]), stakes[1], "wrong stake");
        Assert.equal(fixture.getNextTranscoder(transcoders[1]), address(0), "wrong next transcoder");
        Assert.equal(fixture.getPrevTranscoder(transcoders[1]), transcoders[0], "wrong prev transcoder");
    }

    function test_addTranscoder_betweenBounding() public {
        fixture.addTranscoder(transcoders[0], stakes[0], address(0), address(0));
        fixture.addTranscoder(transcoders[2], stakes[2], transcoders[0], address(0));

        fixture.addTranscoder(transcoders[1], stakes[1], transcoders[0], transcoders[2]);
        Assert.equal(fixture.getSize(), 3, "wrong size");
        Assert.equal(fixture.getTranscoderStake(transcoders[1]), stakes[1], "wrong stake");
        Assert.equal(fixture.getNextTranscoder(transcoders[1]), transcoders[2], "wrong next transcoder");
        Assert.equal(fixture.getPrevTranscoder(transcoders[1]), transcoders[0], "wrong prev transcoder");
    }

    function test_addTranscoder_full() public {
        fixture.setMaxSize(1);
        fixture.addTranscoder(transcoders[0], stakes[0], address(0), address(0));

        TranscoderPoolFixture(address(proxy)).addTranscoder(transcoders[1], stakes[1], address(0), address(0));
        bool result = proxy.execute(address(fixture));
        Assert.isFalse(result, "did not revert");
    }

    function test_addTranscdoer_containsTranscoder() public {
        fixture.addTranscoder(transcoders[0], stakes[0], address(0), address(0));

        TranscoderPoolFixture(address(proxy)).addTranscoder(transcoders[0], stakes[0], address(0), address(0));
        bool result = proxy.execute(address(fixture));
        Assert.isFalse(result, "did not revert");
    }

    function test_addTranscoder_nullTranscoder() public {
        TranscoderPoolFixture(address(proxy)).addTranscoder(address(0), stakes[0], address(0), address(0));
        bool result = proxy.execute(address(fixture));
        Assert.isFalse(result, "did not revert");
    }

    function test_addTranscoder_zeroStake() public {
        TranscoderPoolFixture(address(proxy)).addTranscoder(transcoders[0], 0, address(0), address(0));
        bool result = proxy.execute(address(fixture));
        Assert.isFalse(result, "did not revert");
    }

    function test_addTranscoder_invalidWorseTranscoder() public {
        fixture.addTranscoder(transcoders[0], stakes[0], address(0), address(0));
        fixture.addTranscoder(transcoders[2], stakes[2], transcoders[0], address(0));
        fixture.addTranscoder(transcoders[3], stakes[3], transcoders[2], address(0));

        TranscoderPoolFixture(address(proxy)).addTranscoder(transcoders[1], stakes[1], transcoders[2], transcoders[3]);
        bool result = proxy.execute(address(fixture));
        Assert.isFalse(result, "did not revert");
    }

    function test_addTranscoder_invalidBetterTranscoder() public {
        fixture.addTranscoder(transcoders[0], stakes[0], address(0), address(0));
        fixture.addTranscoder(transcoders[1], stakes[1], transcoders[0], address(0));
        fixture.addTranscoder(transcoders[3], stakes[3], transcoders[1], address(0));

        TranscoderPoolFixture(address(proxy)).addTranscoder(transcoders[2], stakes[2], transcoders[0], transcoders[1]);
        bool result = proxy.execute(address(fixture));
        Assert.isFalse(result, "did not revert");
    }
}
