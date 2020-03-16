import truffleAssert from "truffle-assertions"

import Fixture from "./helpers/Fixture"
import expectRevertWithReason from "../helpers/expectFail"

const Poll = artifacts.require("Poll")

contract("Poll", accounts => {
    let fixture
    let poll
    let startBlock
    let endBlock

    before(() => {
        fixture = new Fixture(web3)
    })

    beforeEach(async () => {
        await fixture.setUp()
        startBlock = await fixture.rpc.getBlockNumberAsync()
        endBlock = startBlock + 10
        poll = await Poll.new(endBlock)
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("constructor", () => {
        it("initialize state: endBlock", async () => {
            assert.equal((await poll.endBlock()).toNumber(), endBlock)
        })
    })

    describe("vote", () => {
        it("emit \"Vote\" event when poll is active", async () => {
            let tx = await poll.vote(0)
            truffleAssert.eventEmitted(tx, "Vote", e => e.voter == accounts[0] && e.choiceID == 0, "Vote event not emitted correctly")
            tx = await poll.vote(1, {from: accounts[1]})
            truffleAssert.eventEmitted(tx, "Vote", e => e.voter == accounts[1] && e.choiceID == 1, "Vote event not emitted correctly")
        })

        it("revert when poll is inactive", async () => {
            await fixture.rpc.waitUntilBlock(endBlock + 1)
            await expectRevertWithReason(poll.vote(0), "poll is over")
        })
    })

    describe("destroy", () => {
        it("revert when poll is active", async () => {
            await expectRevertWithReason(poll.destroy(), "poll is active")
        })

        it("destroy the contract when poll has ended", async () => {
            await fixture.rpc.waitUntilBlock(endBlock + 1)
            let tx = await poll.destroy()
            assert.equal(await web3.eth.getCode(poll.address), "0x")
            assert.equal(tx.receipt.status, true)
        })
    })
})
