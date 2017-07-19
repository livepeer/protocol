import RPC from "../../utils/rpc"
import expectThrow from "../helpers/expectThrow"

var LivepeerProtocol = artifacts.require("LivepeerProtocol")
var LivepeerToken = artifacts.require("LivepeerToken")
var BondingManager = artifacts.require("BondingManager")
var RoundsManager = artifacts.require("RoundsManager")
var JobsManager = artifacts.require("JobsManager")

const ROUND_LENGTH = 50
const NUM_ACTIVE_TRANSCODERS = 1

contract("JobsManager", accounts => {
    let rpc
    let token
    let bondingManager
    let roundsManager
    let jobsManager

    const setup = async () => {
        rpc = new RPC(web3)

        // Start at new round
        await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH)

        token = await LivepeerToken.new()
        // Initial token distribution
        token.mint(accounts[0], 3000000000000000000, {from: accounts[0]})
        token.transfer(accounts[1], 500, {from: accounts[0]})

        bondingManager = await BondingManager.new(token.address, NUM_ACTIVE_TRANSCODERS)
        // Set BondingManager as token owner
        token.transferOwnership(bondingManager.address, {from: accounts[0]})

        roundsManager = await RoundsManager.new()
        jobsManager = await JobsManager.new()

        const protocol = await LivepeerProtocol.new()
        const bondingManagerKey = await protocol.bondingManagerKey.call()
        const roundsManagerKey = await protocol.roundsManagerKey.call()
        const jobsManagerKey = await protocol.jobsManagerKey.call()

        await protocol.setRegistryContract(bondingManagerKey, bondingManager.address)
        await protocol.setRegistryContract(roundsManagerKey, roundsManager.address)
        await protocol.setRegistryContract(jobsManagerKey, jobsManager.address)
        await bondingManager.initialize(protocol.address)
        await roundsManager.initialize(protocol.address)
        await jobsManager.initialize(protocol.address)
    }

    describe("job", () => {
        before(async () => {
            await setup()

            const blockRewardCut = 10
            const feeShare = 5
            const pricePerSegment = 100

            // Account 0 => transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: accounts[0]})
            // Account 1 bonds to Account 0
            await token.approve(bondingManager.address, 100, {from: accounts[1]})
            await bondingManager.bond(100, accounts[0], {from: accounts[1]})
        })

        it("should create a new job", async () => {
            // Fast foward to next round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH)
            await roundsManager.initializeRound({from: accounts[0]})

            const streamId = "1"
            const dummyTranscodingOptions = "0x123"
            const maxPricePerSegment = 100

            // Account 2 creates job
            await jobsManager.job(streamId, dummyTranscodingOptions, maxPricePerSegment, {from: accounts[2]})
        })
    })

    describe("getters", () => {
        const streamId = "1"
        const dummyTranscodingOptions = "abc123"
        const maxPricePerSegment = 100

        before(async () => {
            await setup()

            const blockRewardCut = 10
            const feeShare = 5
            const pricePerSegment = 100

            // Account 0 => transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: accounts[0]})
            // Account 1 bonds to Account 0
            await token.approve(bondingManager.address, 100, {from: accounts[1]})
            await bondingManager.bond(100, accounts[0], {from: accounts[1]})

            // Fast foward to next round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH)
            await roundsManager.initializeRound({from: accounts[0]})

            // Account 2 creates job
            await jobsManager.job(streamId, dummyTranscodingOptions, maxPricePerSegment, {from: accounts[2]})
        })

        describe("getJobDetails", () => {
            it("should return job details", async () => {
                const jobId = 0
                const job = await jobsManager.getJobDetails(jobId)

                assert.equal(job[0], jobId, "job id incorrect")
                assert.equal(job[1], maxPricePerSegment, "max price per segment incorrect")
                assert.equal(job[2], accounts[2], "broadcaster address incorrect")
                assert.equal(job[3], accounts[0], "transcoder address incorrect")
            })
        })

        describe("getJobStreamId", () => {
            it("should return job stream id", async () => {
                const jobId = 0
                const jobStreamId = await jobsManager.getJobStreamId(jobId)

                assert.equal(jobStreamId, streamId, "stream id incorrect")
            })
        })

        describe("getJobTranscodingOptions", () => {
            it("should return job transcoding options", async () => {
                const jobId = 0
                const jobTranscodingOptions = await jobsManager.getJobTranscodingOptions(jobId)

                assert.equal(jobTranscodingOptions, dummyTranscodingOptions, "transcoding options incorrect")
            })
        })
    })
})
