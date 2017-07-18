import RPC from "../../utils/rpc"

var LivepeerProtocol = artifacts.require("LivepeerProtocol")
var LivepeerToken = artifacts.require("LivepeerToken")
var BondingManager = artifacts.require("BondingManager")
var RoundsManager = artifacts.require("RoundsManager")

const ROUND_LENGTH = 50
const CYCLES_PER_ROUND = 2
const NUM_ACTIVE_TRANSCODERS = 1

contract("RoundsManager", accounts => {
    let rpc
    let roundsManager

    beforeEach(async() => {
        rpc = new RPC(web3)
        roundsManager = await RoundsManager.new()

        const protocol = await LivepeerProtocol.new()
        const token = await LivepeerToken.new()
        const bondingManager = await BondingManager.new(token.address)
        const bondingManagerKey = await protocol.bondingManagerKey.call()
        const roundsManagerKey = await protocol.roundsManagerKey.call()

        await protocol.setRegistryContract(bondingManagerKey, bondingManager.address)
        await protocol.setRegistryContract(roundsManagerKey, roundsManager.address)
        await roundsManager.initialize(protocol.address)
        await bondingManager.initialize(protocol.address)
    })

    describe("currentRound", () => {
        it("returns the correct round", async () => {
            const blockNum = web3.eth.blockNumber
            const currentRound = Math.floor(blockNum / ROUND_LENGTH)

            assert.equal(await roundsManager.currentRound(), currentRound, "current round is incorrect")
        })
    })

    describe("currentRoundStartBlock", () => {
        it("returns the correct current round start block", async () => {
            const blockNum = web3.eth.blockNumber
            const startBlock = Math.floor(blockNum / ROUND_LENGTH) * ROUND_LENGTH

            assert.equal(await roundsManager.currentRoundStartBlock(), startBlock, "current round start block is incorrect")
        })
    })

    describe("rewardCallsPerYear", () => {
        it("returns the correct number of calls per year", async () => {
            const numCalls = Math.floor((365 * 24 * 60 * 60) / ROUND_LENGTH) * CYCLES_PER_ROUND * NUM_ACTIVE_TRANSCODERS

            assert.equal(await roundsManager.rewardCallsPerYear(), numCalls, "reward calls per year is incorrect")
        })
    })

    describe("currentRoundInitialized", () => {
        it("returns true if last initialized round is current round", async () => {
            assert.isOk(await roundsManager.currentRoundInitialized(), "not true when last initialized round set to current round")
        })

        it("returns false if last initialized round is not current round", async () => {
            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH)

            assert.isNotOk(await roundsManager.currentRoundInitialized(), "not false when last initialized round not set to current round")
        })
    })

    describe("initializeRound", () => {
        it("should set last initialized round to the current round", async () => {
            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH)

            const blockNum = web3.eth.blockNumber
            const currentRound = Math.floor(blockNum / ROUND_LENGTH)

            await roundsManager.initializeRound()

            assert.equal(await roundsManager.lastInitializedRound.call(), currentRound, "last initialized round not set to current round")
        })
    })
})
