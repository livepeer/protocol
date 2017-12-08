import Fixture from "../helpers/fixture"
import {div} from "../../utils/bn_util"
import expectThrow from "../helpers/expectThrow"

const RoundsManager = artifacts.require("RoundsManager")

const PERC_DIVISOR = 1000000
const PERC_MULTIPLIER = PERC_DIVISOR / 100

const ROUND_LENGTH = 50
const ROUND_LOCK_AMOUNT = 10 * PERC_MULTIPLIER

contract("RoundsManager", accounts => {
    let fixture
    let roundsManager

    before(async () => {
        fixture = new Fixture(web3)
        await fixture.deployController()
        await fixture.deployMocks()

        roundsManager = await fixture.deployAndRegister(RoundsManager, "RoundsManager", fixture.controller.address)
        fixture.roundsManager = roundsManager
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("setParameters", () => {
        it("should set parameters", async () => {
            await roundsManager.setParameters(ROUND_LENGTH, ROUND_LOCK_AMOUNT)

            const roundLength = await roundsManager.roundLength.call()
            assert.equal(roundLength, ROUND_LENGTH, "round length incorrect")
        })

        it("should fail if caller is not authorized", async () => {
            await expectThrow(roundsManager.setParameters(ROUND_LENGTH, ROUND_LOCK_AMOUNT, {from: accounts[1]}))
        })
    })

    describe("currentRound", () => {
        beforeEach(async () => {
            await roundsManager.setParameters(ROUND_LENGTH, ROUND_LOCK_AMOUNT)
        })

        it("returns the correct round", async () => {
            const blockNum = web3.eth.blockNumber
            const roundLength = await roundsManager.roundLength.call()
            const expCurrentRound = div(blockNum, roundLength).floor().toString()

            const currentRound = await roundsManager.currentRound()
            assert.equal(currentRound.toString(), expCurrentRound, "current round is incorrect")
        })
    })

    describe("currentRoundStartBlock", () => {
        beforeEach(async () => {
            await roundsManager.setParameters(ROUND_LENGTH, ROUND_LOCK_AMOUNT)
        })

        it("returns the correct current round start block", async () => {
            const blockNum = web3.eth.blockNumber
            const roundLength = await roundsManager.roundLength.call()
            const expStartBlock = div(blockNum, roundLength).floor().times(roundLength).toString()

            const startBlock = await roundsManager.currentRoundStartBlock()
            assert.equal(startBlock.toString(), expStartBlock, "current round start block is incorrect")
        })
    })

    describe("currentRoundInitialized", () => {
        beforeEach(async () => {
            await roundsManager.setParameters(ROUND_LENGTH, ROUND_LOCK_AMOUNT)
        })

        it("returns true if last initialized round is current round", async () => {
            assert.isOk(await roundsManager.currentRoundInitialized(), "not true when last initialized round set to current round")
        })

        it("returns false if last initialized round is not current round", async () => {
            // Fast forward 1 round
            const roundLength = await roundsManager.roundLength.call()
            await fixture.rpc.waitUntilNextBlockMultiple(roundLength.toNumber())

            await roundsManager.initializeRound()
            await fixture.rpc.waitUntilNextBlockMultiple(roundLength.toNumber())

            assert.isNotOk(await roundsManager.currentRoundInitialized(), "not false when last initialized round not set to current round")
        })
    })

    describe("initializeRound", () => {
        beforeEach(async () => {
            await roundsManager.setParameters(ROUND_LENGTH, ROUND_LOCK_AMOUNT)
        })

        it("should set last initialized round to the current round", async () => {
            // Fast forward 1 round
            const roundLength = await roundsManager.roundLength.call()
            await fixture.rpc.waitUntilNextBlockMultiple(roundLength.toNumber())

            const blockNum = web3.eth.blockNumber
            const currentRound = div(blockNum, roundLength).floor().toString()

            await roundsManager.initializeRound()

            const lastInitializedRound = await roundsManager.lastInitializedRound.call()
            assert.equal(lastInitializedRound.toString(), currentRound, "last initialized round not set to current round")
        })
    })

    describe("currentRoundLocked", () => {
        beforeEach(async () => {
            await roundsManager.setParameters(ROUND_LENGTH, ROUND_LOCK_AMOUNT)
        })

        it("returns false if not in the lock period", async () => {
            // Fast forward 1 round
            const roundLength = await roundsManager.roundLength.call()
            await fixture.rpc.waitUntilNextBlockMultiple(roundLength.toNumber())

            assert.isNotOk(await roundsManager.currentRoundLocked(), "not false when not in lock period")
        })

        it("returns true if in the lock period", async () => {
            // Fast forward 1 round
            const roundLength = await roundsManager.roundLength.call()
            await fixture.rpc.waitUntilNextBlockMultiple(roundLength.toNumber())
            const roundLockAmount = await roundsManager.roundLockAmount.call()
            const roundLockBlocks = roundLength.mul(roundLockAmount).div(PERC_DIVISOR).floor()
            await fixture.rpc.wait(roundLength.sub(roundLockBlocks).toNumber())

            assert.isOk(await roundsManager.currentRoundLocked(), "not true when in lock period")
        })
    })
})
