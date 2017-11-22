pragma solidity ^0.4.17;

import "../../contracts/test/TranscoderPoolFixture.sol";
import "truffle/Assert.sol";


contract TestTranscoderPoolFindWithHints {
    address[] transcoders = [address(1), address(2), address(3), address(4), address(5), address(6)];
    uint256[] stakes = [uint256(3), uint256(5), uint256(7), uint256(9), uint256(11), uint256(13)];

    TranscoderPoolFixture fixture;

    function beforeEach() public {
        fixture = new TranscoderPoolFixture();
        fixture.setMaxSize(10);
    }

    function test_addTranscoder_findNoHintUpdateHead() public {
        fixture.addTranscoder(transcoders[1], stakes[1], address(0), address(0));
        fixture.addTranscoder(transcoders[2], stakes[2], transcoders[1], address(0));
        fixture.addTranscoder(transcoders[3], stakes[3], transcoders[2], address(0));
        fixture.addTranscoder(transcoders[4], stakes[4], transcoders[3], address(0));
        fixture.addTranscoder(transcoders[5], stakes[5], transcoders[4], address(0));

        fixture.addTranscoder(transcoders[0], stakes[0], address(0), address(0));
        Assert.equal(fixture.getSize(), 6, "wrong size");
        Assert.equal(fixture.getWorstTranscoder(), transcoders[0], "wrong head");
        Assert.equal(fixture.getTranscoderStake(transcoders[0]), stakes[0], "wrong stake");
        Assert.equal(fixture.getNextTranscoder(transcoders[0]), transcoders[1], "wrong next transcoder");
        Assert.equal(fixture.getPrevTranscoder(transcoders[0]), address(0), "wrong prev transcoder");
    }

    function test_addTranscoder_findNoHintUpdateTail() public {
        fixture.addTranscoder(transcoders[0], stakes[0], address(0), address(0));
        fixture.addTranscoder(transcoders[1], stakes[1], transcoders[0], address(0));
        fixture.addTranscoder(transcoders[2], stakes[2], transcoders[1], address(0));
        fixture.addTranscoder(transcoders[3], stakes[3], transcoders[2], address(0));
        fixture.addTranscoder(transcoders[4], stakes[4], transcoders[3], address(0));

        fixture.addTranscoder(transcoders[5], stakes[5], address(0), address(0));
        Assert.equal(fixture.getSize(), 6, "wrong size");
        Assert.equal(fixture.getBestTranscoder(), transcoders[5], "wrong tail");
        Assert.equal(fixture.getTranscoderStake(transcoders[5]), stakes[5], "wrong stake");
        Assert.equal(fixture.getNextTranscoder(transcoders[5]), address(0), "wrong next transcoder");
        Assert.equal(fixture.getPrevTranscoder(transcoders[5]), transcoders[4], "wrong prev transcoder");
    }

    function test_addTranscoder_findNoHintBetweenBounding() public {
        fixture.addTranscoder(transcoders[0], stakes[0], address(0), address(0));
        fixture.addTranscoder(transcoders[1], stakes[1], transcoders[0], address(0));
        fixture.addTranscoder(transcoders[3], stakes[3], transcoders[1], address(0));
        fixture.addTranscoder(transcoders[4], stakes[4], transcoders[3], address(0));
        fixture.addTranscoder(transcoders[5], stakes[5], transcoders[4], address(0));

        fixture.addTranscoder(transcoders[2], stakes[2], address(0), address(0));
        Assert.equal(fixture.getSize(), 6, "wrong size");
        Assert.equal(fixture.getTranscoderStake(transcoders[2]), stakes[2], "wrong stake");
        Assert.equal(fixture.getNextTranscoder(transcoders[2]), transcoders[3], "wrong next transcoder");
        Assert.equal(fixture.getPrevTranscoder(transcoders[2]), transcoders[1], "wrong prev transcoder");
    }

    function test_addTranscoder_findWithBetterHintUpdateHead() public {
        fixture.addTranscoder(transcoders[1], stakes[1], address(0), address(0));
        fixture.addTranscoder(transcoders[2], stakes[2], transcoders[1], address(0));
        fixture.addTranscoder(transcoders[3], stakes[3], transcoders[2], address(0));
        fixture.addTranscoder(transcoders[4], stakes[4], transcoders[3], address(0));
        fixture.addTranscoder(transcoders[5], stakes[5], transcoders[4], address(0));

        fixture.addTranscoder(transcoders[0], stakes[0], address(0), transcoders[2]);
        Assert.equal(fixture.getSize(), 6, "wrong size");
        Assert.equal(fixture.getWorstTranscoder(), transcoders[0], "wrong head");
        Assert.equal(fixture.getTranscoderStake(transcoders[0]), stakes[0], "wrong stake");
        Assert.equal(fixture.getNextTranscoder(transcoders[0]), transcoders[1], "wrong next transcoder");
        Assert.equal(fixture.getPrevTranscoder(transcoders[0]), address(0), "wrong prev transcoder");
    }

    function test_addTranscoder_findWithBetterHintBetweenBounding() public {
        fixture.addTranscoder(transcoders[0], stakes[0], address(0), address(0));
        fixture.addTranscoder(transcoders[1], stakes[1], transcoders[0], address(0));
        fixture.addTranscoder(transcoders[3], stakes[3], transcoders[1], address(0));
        fixture.addTranscoder(transcoders[4], stakes[4], transcoders[3], address(0));
        fixture.addTranscoder(transcoders[5], stakes[5], transcoders[4], address(0));

        fixture.addTranscoder(transcoders[2], stakes[2], address(0), transcoders[3]);
        Assert.equal(fixture.getSize(), 6, "wrong size");
        Assert.equal(fixture.getTranscoderStake(transcoders[2]), stakes[2], "wrong stake");
        Assert.equal(fixture.getNextTranscoder(transcoders[2]), transcoders[3], "wrong next transcoder");
        Assert.equal(fixture.getPrevTranscoder(transcoders[2]), transcoders[1], "wrong prev transcoder");
    }

    function test_addTranscoder_findWithWorseHintUpdateTail() public {
        fixture.addTranscoder(transcoders[0], stakes[0], address(0), address(0));
        fixture.addTranscoder(transcoders[1], stakes[1], transcoders[0], address(0));
        fixture.addTranscoder(transcoders[2], stakes[2], transcoders[1], address(0));
        fixture.addTranscoder(transcoders[3], stakes[3], transcoders[1], address(0));
        fixture.addTranscoder(transcoders[4], stakes[4], transcoders[3], address(0));

        fixture.addTranscoder(transcoders[5], stakes[5], transcoders[1], address(0));
        Assert.equal(fixture.getSize(), 6, "wrong size");
        Assert.equal(fixture.getBestTranscoder(), transcoders[5], "wrong tail");
        Assert.equal(fixture.getTranscoderStake(transcoders[5]), stakes[5], "wrong stake");
        Assert.equal(fixture.getNextTranscoder(transcoders[5]), address(0), "wrong next transcoder");
        Assert.equal(fixture.getPrevTranscoder(transcoders[5]), transcoders[4], "wrong prev transcoder");
    }

    function test_addTranscoder_findWithWorseHintBetweenBounding() public {
        fixture.addTranscoder(transcoders[0], stakes[0], address(0), address(0));
        fixture.addTranscoder(transcoders[1], stakes[1], transcoders[0], address(0));
        fixture.addTranscoder(transcoders[3], stakes[3], transcoders[1], address(0));
        fixture.addTranscoder(transcoders[4], stakes[4], transcoders[3], address(0));
        fixture.addTranscoder(transcoders[5], stakes[5], transcoders[4], address(0));

        fixture.addTranscoder(transcoders[2], stakes[2], transcoders[0], address(0));
        Assert.equal(fixture.getSize(), 6, "wrong size");
        Assert.equal(fixture.getTranscoderStake(transcoders[2]), stakes[2], "wrong stake");
        Assert.equal(fixture.getNextTranscoder(transcoders[2]), transcoders[3], "wrong next transcoder");
        Assert.equal(fixture.getPrevTranscoder(transcoders[2]), transcoders[1], "wrong prev transcoder");
    }

    function test_addTranscoder_findWithBoundingHintAscendingBetweenBounding() public {
        fixture.addTranscoder(transcoders[0], stakes[0], address(0), address(0));
        fixture.addTranscoder(transcoders[1], stakes[1], transcoders[0], address(0));
        fixture.addTranscoder(transcoders[2], stakes[2], transcoders[1], address(0));
        fixture.addTranscoder(transcoders[4], stakes[4], transcoders[2], address(0));
        fixture.addTranscoder(transcoders[5], stakes[5], transcoders[4], address(0));

        fixture.addTranscoder(transcoders[3], stakes[3], transcoders[2], transcoders[4]);
        Assert.equal(fixture.getSize(), 6, "wrong size");
        Assert.equal(fixture.getTranscoderStake(transcoders[3]), stakes[3], "wrong stake");
        Assert.equal(fixture.getNextTranscoder(transcoders[3]), transcoders[4], "wrong next transcoder");
        Assert.equal(fixture.getPrevTranscoder(transcoders[3]), transcoders[2], "wrong prev transcoder");
    }

    function test_addTranscoder_findWithBoundingHintDescendingBetweenBounding() public {
        fixture.addTranscoder(transcoders[0], stakes[0], address(0), address(0));
        fixture.addTranscoder(transcoders[1], stakes[1], transcoders[0], address(0));
        fixture.addTranscoder(transcoders[3], stakes[3], transcoders[1], address(0));
        fixture.addTranscoder(transcoders[4], stakes[4], transcoders[3], address(0));
        fixture.addTranscoder(transcoders[5], stakes[5], transcoders[4], address(0));

        fixture.addTranscoder(transcoders[2], stakes[2], transcoders[1], transcoders[4]);
        Assert.equal(fixture.getSize(), 6, "wrong size");
        Assert.equal(fixture.getTranscoderStake(transcoders[2]), stakes[2], "wrong stake");
        Assert.equal(fixture.getNextTranscoder(transcoders[2]), transcoders[3], "wrong next transcoder");
        Assert.equal(fixture.getPrevTranscoder(transcoders[2]), transcoders[1], "wrong prev transcoder");
    }
}
