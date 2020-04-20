import truffleAssert from "truffle-assertions"

import Fixture from "./helpers/Fixture"
import expectRevertWithReason from "../helpers/expectFail"
import {functionSig} from "../../utils/helpers"

const PollCreator = artifacts.require("PollCreator")
const GenericMock = artifacts.require("GenericMock")

const QUORUM = 20
const THRESHOLD = 50
const POLL_PERIOD = 10 * 5760

contract("PollCreator", accounts => {
    let fixture
    let token
    let pollCreator

    before(async () => {
        fixture = new Fixture(web3)
        token = await GenericMock.new()
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("constructor", () => {
        before(async () => {
            pollCreator = await PollCreator.new(token.address)
        })

        it("initialize state: token", async () => {
            assert.equal(await pollCreator.token(), token.address)
        })
    })

    describe("createPoll", () => {
        const hash = "0x1230000000000000000000000000000000000000"

        before(async () => {
            pollCreator = await PollCreator.new(token.address)
        })

        it("revert when not enough tokens approved", async () => {
            await expectRevertWithReason(pollCreator.createPoll(hash), "LivepeerToken transferFrom failed")
        })

        it("creates a poll", async () => {
            await token.setMockBool(functionSig("transferFrom(address,address,uint256)"), true)
            let start = await fixture.rpc.getBlockNumberAsync()
            let end = start + POLL_PERIOD + 1 // + 1 because createPoll tx will mine a new block
            let tx = await pollCreator.createPoll(hash)
            truffleAssert.eventEmitted(
                tx,
                "PollCreated",
                e => e.proposal == hash
                && e.endBlock.toNumber() == end
                && e.quorum.toNumber() == QUORUM
                && e.threshold.toNumber() == THRESHOLD
                ,
                "PollCreated event not emitted correctly"
            )
        })
    })
})
