import Fixture from "../helpers/fixture"
import {mul, div} from "../../utils/bn_util"
import expectThrow from "../helpers/expectThrow"

const RoundsManager = artifacts.require("RoundsManager")

const BLOCK_TIME = 1
const ROUND_LENGTH = 50

contract("RoundsManager", accounts => {
    let fixture
    let roundsManager

    before(async () => {
        fixture = new Fixture(web3)
        await fixture.deployController()
        await fixture.deployMocks()

        roundsManager = await fixture.deployAndRegister(RoundsManager, "RoundsManager", fixture.controller.address)
        fixture.roundsManager = roundsManager

        await fixture.addPermissions()
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("setParameters", () => {
        it("should set parameters", async () => {
            await roundsManager.setParameters(BLOCK_TIME, ROUND_LENGTH)

            const blockTime = await roundsManager.blockTime.call()
            assert.equal(blockTime, BLOCK_TIME, "block time incorrect")
            const roundLength = await roundsManager.roundLength.call()
            assert.equal(roundLength, ROUND_LENGTH, "round length incorrect")
        })

        it("should fail if caller is not authorized", async () => {
            await expectThrow(roundsManager.setParameters(BLOCK_TIME, ROUND_LENGTH, {from: accounts[1]}))
        })
    })

    describe("currentRound", () => {
        beforeEach(async () => {
            await roundsManager.setParameters(BLOCK_TIME, ROUND_LENGTH)
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
            await roundsManager.setParameters(BLOCK_TIME, ROUND_LENGTH)
        })

        it("returns the correct current round start block", async () => {
            const blockNum = web3.eth.blockNumber
            const roundLength = await roundsManager.roundLength.call()
            const expStartBlock = div(blockNum, roundLength).floor().times(roundLength).toString()

            const startBlock = await roundsManager.currentRoundStartBlock()
            assert.equal(startBlock.toString(), expStartBlock, "current round start block is incorrect")
        })
    })

    describe("roundsPerYear", () => {
        beforeEach(async () => {
            await roundsManager.setParameters(BLOCK_TIME, ROUND_LENGTH)
        })

        it("returns the correct number of calls per year", async () => {
            const roundLength = await roundsManager.roundLength.call()
            const expRounds = mul(365, 24, 60, 60).div(roundLength).toString()

            const rounds = await roundsManager.roundsPerYear()
            assert.equal(rounds.toString(), expRounds.toString(), "rounds per year is incorrect")
        })
    })

    describe("currentRoundInitialized", () => {
        beforeEach(async () => {
            await roundsManager.setParameters(BLOCK_TIME, ROUND_LENGTH)
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
            await roundsManager.setParameters(BLOCK_TIME, ROUND_LENGTH)
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
})
