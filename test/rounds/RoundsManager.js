import RPC from "../../utils/rpc"
import ethUtil from "ethereumjs-util"
import ethAbi from "ethereumjs-abi"

const LivepeerProtocol = artifacts.require("LivepeerProtocol")
const BondingManagerMock = artifacts.require("BondingManagerMock")
const RoundsManager = artifacts.require("RoundsManager")

const BLOCK_TIME = 1
const ROUND_LENGTH = 50
const NUM_ACTIVE_TRANSCODERS = 1

contract("RoundsManager", accounts => {
    let rpc
    let roundsManager

    const setup = async () => {
        rpc = new RPC(web3)

        const protocol = await LivepeerProtocol.new()

        roundsManager = await RoundsManager.new(protocol.address, BLOCK_TIME, ROUND_LENGTH, NUM_ACTIVE_TRANSCODERS)

        const bondingManager = await BondingManagerMock.new(protocol.address)
        await protocol.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["BondingManager"])), bondingManager.address)

        await protocol.unpause()
    }

    beforeEach(async () => {
        await setup()
    })

    describe("currentRound", () => {
        it("returns the correct round", async () => {
            const blockNum = web3.eth.blockNumber
            const roundLength = await roundsManager.roundLength.call()
            const currentRound = Math.floor(blockNum / roundLength.toNumber())

            assert.equal(await roundsManager.currentRound(), currentRound, "current round is incorrect")
        })
    })

    describe("currentRoundStartBlock", () => {
        it("returns the correct current round start block", async () => {
            const blockNum = web3.eth.blockNumber
            const roundLength = await roundsManager.roundLength.call()
            const startBlock = Math.floor(blockNum / roundLength.toNumber()) * roundLength.toNumber()

            assert.equal(await roundsManager.currentRoundStartBlock(), startBlock, "current round start block is incorrect")
        })
    })

    describe("rewardCallsPerYear", () => {
        it("returns the correct number of calls per year", async () => {
            const roundLength = await roundsManager.roundLength.call()
            const numActiveTranscoders = await roundsManager.numActiveTranscoders.call()
            const numCalls = Math.floor((365 * 24 * 60 * 60) / roundLength.toNumber()) * numActiveTranscoders.toNumber()

            assert.equal(await roundsManager.rewardCallsPerYear(), numCalls, "reward calls per year is incorrect")
        })
    })

    describe("currentRoundInitialized", () => {
        it("returns true if last initialized round is current round", async () => {
            assert.isOk(await roundsManager.currentRoundInitialized(), "not true when last initialized round set to current round")
        })

        it("returns false if last initialized round is not current round", async () => {
            // Fast forward 1 round
            const roundLength = await roundsManager.roundLength.call()
            await rpc.waitUntilNextBlockMultiple(20, roundLength.toNumber())

            assert.isNotOk(await roundsManager.currentRoundInitialized(), "not false when last initialized round not set to current round")
        })
    })

    describe("initializeRound", () => {
        it("should set last initialized round to the current round", async () => {
            // Fast forward 1 round
            const roundLength = await roundsManager.roundLength.call()
            await rpc.waitUntilNextBlockMultiple(20, roundLength.toNumber())

            const blockNum = web3.eth.blockNumber
            const currentRound = Math.floor(blockNum / roundLength.toNumber())

            await roundsManager.initializeRound()

            assert.equal(await roundsManager.lastInitializedRound.call(), currentRound, "last initialized round not set to current round")
        })
    })
})
