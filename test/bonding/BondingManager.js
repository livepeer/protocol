import RPC from "../../utils/rpc"
import expectThrow from "../helpers/expectThrow"

const LivepeerProtocol = artifacts.require("LivepeerProtocol")
const LivepeerToken = artifacts.require("LivepeerToken")
const BondingManager = artifacts.require("BondingManager")
const RoundsManager = artifacts.require("RoundsManager")

const ROUND_LENGTH = 50
const UNBONDING_PERIOD = 2
const NUM_ACTIVE_TRANSCODERS = 1

contract("BondingManager", accounts => {
    let rpc
    let token
    let bondingManager

    const setup = async () => {
        rpc = new RPC(web3)

        // Start at new round
        await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH)

        token = await LivepeerToken.new()
        // Initial token distribution. Mint 3 LPT to contract creator
        token.mint(accounts[0], 3000000000000000000)
        bondingManager = await BondingManager.new(token.address, NUM_ACTIVE_TRANSCODERS)

        const protocol = await LivepeerProtocol.new()
        const roundsManager = await RoundsManager.new()
        const bondingManagerKey = await protocol.bondingManagerKey.call()
        const roundsManagerKey = await protocol.roundsManagerKey.call()

        await protocol.setRegistryContract(bondingManagerKey, bondingManager.address)
        await protocol.setRegistryContract(roundsManagerKey, roundsManager.address)
        await roundsManager.initialize(protocol.address)
        await bondingManager.initialize(protocol.address)
    }

    describe("transcoder", () => {
        before(async () => {
            await setup()
        })

        it("should create a new transcoder", async () => {
            const blockRewardCut = 10
            const feeShare = 5
            const pricePerSegment = 100

            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: accounts[0]})

            const transcoder = await bondingManager.transcoders.call(accounts[0])
            assert.equal(transcoder[8], blockRewardCut, "pending block reward cut not set correctly")
            assert.equal(transcoder[9], feeShare, "pending fee share not set correctly")
            assert.equal(transcoder[10], pricePerSegment, "pending price per segment not set correctly")
        })

        it("should fail if blockRewardCut > 100", async () => {
            const blockRewardCut = 101
            const feeShare = 5
            const pricePerSegment = 100

            await expectThrow(bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: accounts[0]}))
        })

        it("should fail if feeShare > 100", async () => {
            const blockRewardCut = 10
            const feeShare = 101
            const pricePerSegment = 100

            await expectThrow(bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: accounts[0]}))
        })
    })

    describe("resignAsTranscoder", () => {
        before(async () => {
            await setup()

            const blockRewardCut = 10
            const feeShare = 5
            const pricePerSegment = 100

            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: accounts[0]})
            await bondingManager.resignAsTranscoder({from: accounts[0]})
        })

        it("should set a transcoder as inactive", async () => {
            const transcoder = await bondingManager.transcoders.call(accounts[0])
            assert.isNotOk(transcoder[11], "transcoder not inactive")
        })

        it("should set delegator withdraw round", async () => {
            const blockNum = web3.eth.blockNumber
            const currentRound = Math.floor(blockNum / ROUND_LENGTH)
            const transcoder = await bondingManager.transcoders.call(accounts[0])
            assert.equal(transcoder[2], currentRound + UNBONDING_PERIOD, "delegator withdraw round incorrect")
        })
    })

    describe("bond", () => {
        before(async () => {
            await setup()

            const blockRewardCut = 10
            const feeShare = 5
            const pricePerSegment = 100

            // Account 0 => transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: accounts[0]})
            // Account 1 => transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: accounts[1]})
        })

        it("can bond stake towards self as transcoder", async () => {
            // Account 0 bonds to self as transcoder
            await token.approve(bondingManager.address, 2000, {from: accounts[0]})
            await bondingManager.bond(2000, accounts[0], {from: accounts[0]})

            const transcoder = await bondingManager.transcoders.call(accounts[0])
            assert.equal(transcoder[1], 2000, "bonded amount incorrect")
        })

        it("can bond stake towards a transcoder as delegator", async () => {
            // Account 2 bonds to Account 0
            await token.transfer(accounts[2], 2000, {from: accounts[0]})
            await token.approve(bondingManager.address, 2000, {from: accounts[2]})
            await bondingManager.bond(2000, accounts[0], {from: accounts[2]})

            const delegator = await bondingManager.delegators.call(accounts[2])
            assert.equal(delegator[1], 2000, "bonded amount incorrect")
            assert.equal(delegator[2], accounts[0], "transcoder address incorrect")
        })

        it("can increase stake towards a transcoder as delegator", async () => {
            // Account 2 bonds to Account 0
            await token.transfer(accounts[2], 2000, {from: accounts[0]})
            await token.approve(bondingManager.address, 2000, {from: accounts[2]})
            await bondingManager.bond(2000, accounts[0], {from: accounts[2]})

            const delegator = await bondingManager.delegators.call(accounts[2])
            assert.equal(delegator[1], 4000, "bonded amount incorrect")
        })

        it("can move stake to another transcoder as delegator", async () => {
            // Account 2 bonds to Account 1
            await bondingManager.bond(0, accounts[1], {from: accounts[2]})

            const delegator = await bondingManager.delegators.call(accounts[2])
            assert.equal(delegator[2], accounts[1], "transcoder address incorrect")
        })
    })

    describe("setActiveTranscoders", async () => {
        before(async () => {
            await setup()

            const blockRewardCut = 10
            const feeShare = 5
            const pricePerSegment = 100

            // Account 0 => transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: accounts[0]})
        })

        it("should throw if sender is not RoundsManager", async () => {
            await expectThrow(bondingManager.setActiveTranscoders({from: accounts[0]}))
        })
    })
})
