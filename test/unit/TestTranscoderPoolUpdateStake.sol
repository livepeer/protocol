pragma solidity ^0.4.17;

import "../../contracts/test/TranscoderPoolFixture.sol";
import "truffle/Assert.sol";


contract TestTranscoderPoolUpdateStake {
    address[] transcoders = [address(1), address(2), address(3), address(4), address(5), address(6)];
    uint256[] stakes = [uint256(3), uint256(5), uint256(7), uint256(9), uint256(11), uint256(13)];

    TranscoderPoolFixture fixture;

    function beforeEach() public {
        fixture = new TranscoderPoolFixture();
        fixture.setMaxSize(10);
    }

    function test_increaseTranscoderStake_noHint() public {
        fixture.addTranscoder(transcoders[0], stakes[0], address(0), address(0));
        fixture.addTranscoder(transcoders[1], stakes[1], transcoders[0], address(0));
        fixture.addTranscoder(transcoders[2], stakes[2], transcoders[1], address(0));
        fixture.addTranscoder(transcoders[3], stakes[3], transcoders[2], address(0));
        fixture.addTranscoder(transcoders[4], stakes[4], transcoders[3], address(0));
        fixture.addTranscoder(transcoders[5], stakes[5], transcoders[4], address(0));

        fixture.increaseTranscoderStake(transcoders[3], 3, address(0), address(0));
        Assert.equal(fixture.getTranscoderStake(transcoders[3]), stakes[3] + 3, "wrong stake");
        Assert.equal(fixture.getNextTranscoder(transcoders[3]), transcoders[5], "wrong next transcoder");
        Assert.equal(fixture.getPrevTranscoder(transcoders[3]), transcoders[4], "wrong prev transcoder");
        Assert.equal(fixture.getNextTranscoder(transcoders[2]), transcoders[4], "wrong next transcoder");
        Assert.equal(fixture.getPrevTranscoder(transcoders[4]), transcoders[2], "wrong prev transcoder");
    }

    function test_decreaseTranscoderStake_noHint() public {
        fixture.addTranscoder(transcoders[0], stakes[0], address(0), address(0));
        fixture.addTranscoder(transcoders[1], stakes[1], transcoders[0], address(0));
        fixture.addTranscoder(transcoders[2], stakes[2], transcoders[1], address(0));
        fixture.addTranscoder(transcoders[3], stakes[3], transcoders[2], address(0));
        fixture.addTranscoder(transcoders[4], stakes[4], transcoders[3], address(0));
        fixture.addTranscoder(transcoders[5], stakes[5], transcoders[4], address(0));

        fixture.decreaseTranscoderStake(transcoders[4], 3, address(0), address(0));
        Assert.equal(fixture.getTranscoderStake(transcoders[4]), stakes[4] - 3, "wrong stake");
        Assert.equal(fixture.getNextTranscoder(transcoders[4]), transcoders[3], "wrong next transcoder");
        Assert.equal(fixture.getPrevTranscoder(transcoders[4]), transcoders[2], "wrong prev transcoder");
        Assert.equal(fixture.getNextTranscoder(transcoders[3]), transcoders[5], "wrong next transcoder");
        Assert.equal(fixture.getPrevTranscoder(transcoders[5]), transcoders[3], "wrong prev transocder");
    }
}
