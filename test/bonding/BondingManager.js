import ethUtil from "ethereumjs-util"
import ethAbi from "ethereumjs-abi"
import expectThrow from "../helpers/expectThrow"
import {toSmallestUnits, add} from "../../utils/bn_util"

const LivepeerProtocol = artifacts.require("LivepeerProtocol")
const LivepeerToken = artifacts.require("LivepeerToken")
const BondingManager = artifacts.require("BondingManager")
const RoundsManagerMock = artifacts.require("RoundsManagerMock")
const JobsManagerMock = artifacts.require("JobsManagerMock")

const NUM_ACTIVE_TRANSCODERS = 1
const UNBONDING_PERIOD = 2

contract("BondingManager", accounts => {
    const minter = accounts[0]

    let token
    let jobsManager
    let roundsManager
    let bondingManager

    const setup = async () => {
        token = await LivepeerToken.new()
        // Initial token distribution
        token.mint(minter, toSmallestUnits(5))
        await token.transfer(accounts[1], toSmallestUnits(1), {from: minter})
        await token.transfer(accounts[2], toSmallestUnits(1), {from: minter})
        await token.transfer(accounts[3], toSmallestUnits(1), {from: minter})
        await token.transfer(accounts[4], toSmallestUnits(1), {from: minter})

        const protocol = await LivepeerProtocol.new()

        bondingManager = await BondingManager.new(protocol.address, token.address, NUM_ACTIVE_TRANSCODERS, UNBONDING_PERIOD)

        roundsManager = await RoundsManagerMock.new(bondingManager.address)
        await protocol.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["RoundsManager"])), roundsManager.address)

        jobsManager = await JobsManagerMock.new(bondingManager.address)
        await protocol.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["JobsManager"])), jobsManager.address)

        await protocol.unpause()
    }

    describe("transcoder", () => {
        const tAddr = accounts[1]
        const blockRewardCut = 10
        const feeShare = 5
        const pricePerSegment = 10

        before(async () => {
            await setup()
        })

        it("should throw if round is not initialized", async () => {
            roundsManager.setCurrentRoundInitialized(false)

            await expectThrow(bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr}))
        })

        it("should fail if blockRewardCut > 100", async () => {
            roundsManager.setCurrentRoundInitialized(true)

            const invalidBlockRewardCut = 101
            await expectThrow(bondingManager.transcoder(invalidBlockRewardCut, feeShare, pricePerSegment, {from: tAddr}))
        })

        it("should fail if feeShare > 100", async () => {
            const invalidFeeShare = 101
            await expectThrow(bondingManager.transcoder(blockRewardCut, invalidFeeShare, pricePerSegment, {from: tAddr}))
        })

        it("should create a new transcoder with 0 stake", async () => {
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr})

            const transcoder = await bondingManager.transcoders.call(tAddr)
            assert.equal(transcoder[5], blockRewardCut, "pending block reward cut incorrect")
            assert.equal(transcoder[6], feeShare, "pending fee share incorrect")
            assert.equal(transcoder[7], pricePerSegment, "pending price per segment incorrect")

            const transcoderTotalStake = await bondingManager.transcoderTotalStake(tAddr)
            assert.equal(transcoderTotalStake, 0, "transcoder total stake incorrecet")
        })

        it("should create a new transcoder with delegated stake", async () => {
            await token.approve(bondingManager.address, 2000, {from: accounts[2]})
            await bondingManager.bond(2000, tAddr, {from: accounts[2]})

            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr})
            const transcoderTotalStake = await bondingManager.transcoderTotalStake(tAddr)
            assert.equal(transcoderTotalStake, 2000, "transcoder total stake incorrect")
        })
    })

    describe("resignAsTranscoder", () => {
        const tAddr = accounts[1]

        before(async () => {
            await setup()

            const blockRewardCut = 10
            const feeShare = 5
            const pricePerSegment = 100

            await roundsManager.setCurrentRoundInitialized(true)
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr})
        })

        it("should throw if current round is not initialized", async () => {
            await roundsManager.setCurrentRoundInitialized(false)
            await expectThrow(bondingManager.resignAsTranscoder({from: tAddr}))
        })

        it("should throw if transcoder is not registered", async () => {
            await expectThrow(bondingManager.resignAsTranscoder({from: accounts[2]}))
        })

        it("should set delegator withdraw round", async () => {
            const currentRound = 100
            await roundsManager.setCurrentRound(currentRound)
            await roundsManager.setCurrentRoundInitialized(true)

            const unbondingPeriod = await bondingManager.unbondingPeriod.call()
            const withdrawRound = currentRound + unbondingPeriod.toNumber()

            await bondingManager.resignAsTranscoder({from: tAddr})

            const resignedTranscoder = await bondingManager.transcoders.call(tAddr)
            assert.equal(resignedTranscoder[0], withdrawRound, "withdraw round is incorrect")
        })

        it("should set a transcoder as resigned", async () => {
            const transcoderStatus = await bondingManager.transcoderStatus(tAddr)
            assert.equal(transcoderStatus, 2, "transcoder is not resigned")
        })
    })

    describe("bond", () => {
        const tAddr0 = accounts[1]
        const tAddr1 = accounts[2]
        const dAddr = accounts[3]

        before(async () => {
            await setup()

            const blockRewardCut = 10
            const feeShare = 5
            const pricePerSegment = 10

            await roundsManager.setCurrentRoundInitialized(true)
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr0})
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr1})
        })

        it("can bond stake towards self as transcoder", async () => {
            await token.approve(bondingManager.address, 2000, {from: tAddr0})
            await bondingManager.bond(2000, tAddr0, {from: tAddr0})

            const tDelegator = await bondingManager.delegators.call(tAddr0)
            assert.equal(tDelegator[0], 2000, "bonded amount incorrect")
        })

        it("can bond stake towards a transcoder as delegator", async () => {
            await token.approve(bondingManager.address, 2000, {from: dAddr})
            await bondingManager.bond(2000, tAddr0, {from: dAddr})

            const delegator = await bondingManager.delegators.call(dAddr)
            assert.equal(delegator[0], 2000, "bonded amount incorrect")
            assert.equal(delegator[1], tAddr0, "transcoder address incorrect")
        })

        it("can increase stake towards a transcoder as delegator", async () => {
            await token.approve(bondingManager.address, 2000, {from: dAddr})
            await bondingManager.bond(2000, tAddr0, {from: dAddr})

            const delegator = await bondingManager.delegators.call(dAddr)
            assert.equal(delegator[0], 4000, "bonded amount incorrect")
        })

        it("can move stake to another transcoder as delegator", async () => {
            await bondingManager.bond(0, tAddr1, {from: dAddr})

            const delegator = await bondingManager.delegators.call(dAddr)
            assert.equal(delegator[1], tAddr1, "transcoder address incorrect")
        })
    })

    describe("updateTranscoderFeePool", async () => {
        const tAddr = accounts[1]
        const dAddr = accounts[2]

        // Transcoder rates
        const blockRewardCut = 10
        const feeShare = 5
        const pricePerSegment = 10

        // Mock fees params
        const fees = 300
        const claimBlock = 100
        const transcoderTotalStake = 1000

        before(async () => {
            await setup()

            await roundsManager.setCurrentRoundInitialized(true)

            // Register transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr})

            // Transcoder bonds
            await token.approve(bondingManager.address, 2000, {from: tAddr})
            await bondingManager.bond(2000, tAddr, {from: tAddr})

            // Delegator bonds to transcoder
            await token.approve(bondingManager.address, 2000, {from: dAddr})
            await bondingManager.bond(2000, tAddr, {from: dAddr})

            await jobsManager.setMockTranscoder(tAddr)
            await jobsManager.setMockFees(fees)
            await jobsManager.setMockClaimBlock(claimBlock)
            await jobsManager.setMockTranscoderTotalStake(transcoderTotalStake)

            // Set active transcoders
            await roundsManager.initializeRound()
        })

        it("should update transcoder's total stake", async () => {
            // Call updateTranscoderFeePool via transaction from JobsManager
            await jobsManager.distributeFees()

            const transcoderTotalStake = await bondingManager.transcoderTotalStake(tAddr)
            assert.equal(transcoderTotalStake.toString(), add(2000, 2000, fees), "transcoder total stake incorrect")
        })

        it("should update transcoder's bond with fee share", async () => {
            const transcoderFeeShare = Math.floor((fees * (100 - feeShare)) / 100)

            const tDelegator = await bondingManager.delegators.call(tAddr)
            assert.equal(tDelegator[0].toString(), add(2000, transcoderFeeShare), "transcoder bond incorrect")
        })
    })

    describe("delegatorStake", async () => {
        const tAddr = accounts[1]
        const dAddr = accounts[2]

        // Transcoder rates
        const blockRewardCut = 10
        const feeShare = 5
        const pricePerSegment = 10

        // Mock fees params
        const fees = 300
        const claimBlock = web3.eth.blockNumber + 1000
        const transcoderTotalStake = 4000

        before(async () => {
            await setup()

            await roundsManager.setCurrentRoundInitialized(true)
            await roundsManager.setCurrentRound(5)

            // Register transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr})

            // Transcoder bonds
            await token.approve(bondingManager.address, 2000, {from: tAddr})
            await bondingManager.bond(2000, tAddr, {from: tAddr})

            // Delegator bonds to transcoder
            await token.approve(bondingManager.address, 2000, {from: dAddr})
            await bondingManager.bond(2000, tAddr, {from: dAddr})

            await jobsManager.setMockTranscoder(tAddr)
            await jobsManager.setMockFees(fees)
            await jobsManager.setMockClaimBlock(claimBlock)
            await jobsManager.setMockTranscoderTotalStake(transcoderTotalStake)

            // Set active transcoders
            await roundsManager.initializeRound()

            // Set current round so delegator is bonded
            await roundsManager.setCurrentRound(7)

            // Call updateTranscoderFeePool via transaction from JobsManager
            await jobsManager.distributeFees()
        })

        it("should compute delegator stake with latest fees", async () => {
            const delegatorsFeeShare = Math.floor((fees * feeShare) / 100)
            const delegatorFeeShare = Math.floor((2000 * delegatorsFeeShare) / transcoderTotalStake)
            const delegatorStake = await bondingManager.delegatorStake(dAddr)
            assert.equal(delegatorStake.toString(), add(2000, delegatorFeeShare))
        })
    })
})
