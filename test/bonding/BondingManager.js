import ethUtil from "ethereumjs-util"
import ethAbi from "ethereumjs-abi"
import expectThrow from "../helpers/expectThrow"

const LivepeerProtocol = artifacts.require("LivepeerProtocol")
const LivepeerToken = artifacts.require("LivepeerToken")
const BondingManager = artifacts.require("BondingManager")
const RoundsManagerMock = artifacts.require("RoundsManagerMock")
const JobsManagerMock = artifacts.require("JobsManagerMock")

const NUM_ACTIVE_TRANSCODERS = 1

contract("BondingManager", accounts => {
    const minter = accounts[0]

    let token
    let jobsManager
    let roundsManager
    let bondingManager

    const setup = async () => {
        token = await LivepeerToken.new()
        // Initial token distribution. Mint 3 LPT to contract creator
        token.mint(minter, 3000000000000000000)

        const protocol = await LivepeerProtocol.new()

        bondingManager = await BondingManager.new(protocol.address, token.address, NUM_ACTIVE_TRANSCODERS)

        roundsManager = await RoundsManagerMock.new(bondingManager.address)
        await protocol.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["RoundsManager"])), roundsManager.address)

        jobsManager = await JobsManagerMock.new(bondingManager.address)
        await protocol.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["JobsManager"])), jobsManager.address)
    }

    describe("transcoder", () => {
        const transcoder = accounts[1]
        const blockRewardCut = 10
        const feeShare = 5
        const pricePerSegment = 10

        before(async () => {
            await setup()
        })

        it("should throw if round is not initialized", async () => {
            roundsManager.setCurrentRoundInitialized(false)

            await expectThrow(bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: transcoder}))
        })

        it("should fail if blockRewardCut > 100", async () => {
            roundsManager.setCurrentRoundInitialized(true)

            const invalidBlockRewardCut = 101
            await expectThrow(bondingManager.transcoder(invalidBlockRewardCut, feeShare, pricePerSegment, {from: transcoder}))
        })

        it("should fail if feeShare > 100", async () => {
            const invalidFeeShare = 101
            await expectThrow(bondingManager.transcoder(blockRewardCut, invalidFeeShare, pricePerSegment, {from: transcoder}))
        })

        it("should create a new transcoder", async () => {
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: transcoder})

            const transcoderRates = await bondingManager.transcoderRates(transcoder)
            assert.equal(transcoderRates[3], blockRewardCut, "pending block reward cut incorrect")
            assert.equal(transcoderRates[4], feeShare, "pending fee share incorrect")
            assert.equal(transcoderRates[5], pricePerSegment, "pending price per segment incorrect")
        })
    })

    describe("resignAsTranscoder", () => {
        const transcoder = accounts[1]

        before(async () => {
            await setup()

            const blockRewardCut = 10
            const feeShare = 5
            const pricePerSegment = 100

            await roundsManager.setCurrentRoundInitialized(true)
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: transcoder})
        })

        it("should throw if current round is not initialized", async () => {
            await roundsManager.setCurrentRoundInitialized(false)
            await expectThrow(bondingManager.resignAsTranscoder({from: transcoder}))
        })

        it("should throw if transcoder is not registered", async () => {
            await expectThrow(bondingManager.resignAsTranscoder({from: accounts[2]}))
        })

        it("should set withdraw round", async () => {
            const currentRound = 100
            await roundsManager.setCurrentRound(currentRound)
            await roundsManager.setCurrentRoundInitialized(true)

            const unbondingPeriod = await bondingManager.unbondingPeriod.call()
            const withdrawRound = currentRound + unbondingPeriod.toNumber()

            await bondingManager.resignAsTranscoder({from: transcoder})

            const resignedTranscoder = await bondingManager.transcoders.call(transcoder)
            assert.equal(resignedTranscoder[2], withdrawRound, "withdraw round is incorrect")
        })

        it("should set a transcoder as unbonding", async () => {
            const transcoderStatus = await bondingManager.transcoderStatus(transcoder)
            assert.equal(transcoderStatus, 2, "transcoder is not unbonding")
        })
    })

    describe("bond", () => {
        const transcoder0 = accounts[1]
        const transcoder1 = accounts[2]
        const delegator = accounts[3]

        before(async () => {
            await setup()

            // Distribute tokens
            await token.transfer(transcoder0, 100000, {from: minter})
            await token.transfer(transcoder1, 100000, {from: minter})
            await token.transfer(delegator, 100000, {from: minter})

            const blockRewardCut = 10
            const feeShare = 5
            const pricePerSegment = 10

            await roundsManager.setCurrentRoundInitialized(true)
            // Account 0 => transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: transcoder0})
            // Account 1 => transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: transcoder1})
        })

        it("can bond stake towards self as transcoder", async () => {
            await token.approve(bondingManager.address, 2000, {from: transcoder0})
            await bondingManager.bond(2000, transcoder0, {from: transcoder0})

            const registeredTranscoder = await bondingManager.transcoders.call(transcoder0)
            assert.equal(registeredTranscoder[1], 2000, "bonded amount incorrect")
        })

        it("can bond stake towards a transcoder as delegator", async () => {
            await token.approve(bondingManager.address, 2000, {from: delegator})
            await bondingManager.bond(2000, transcoder0, {from: delegator})

            const registeredDelegator = await bondingManager.delegators.call(delegator)
            assert.equal(registeredDelegator[1], 2000, "bonded amount incorrect")
            assert.equal(registeredDelegator[2], transcoder0, "transcoder address incorrect")
        })

        it("can increase stake towards a transcoder as delegator", async () => {
            await token.approve(bondingManager.address, 2000, {from: delegator})
            await bondingManager.bond(2000, transcoder0, {from: delegator})

            const registeredDelegator = await bondingManager.delegators.call(delegator)
            assert.equal(registeredDelegator[1], 4000, "bonded amount incorrect")
        })

        it("can move stake to another transcoder as delegator", async () => {
            await bondingManager.bond(0, transcoder1, {from: delegator})

            const registeredDelegator = await bondingManager.delegators.call(delegator)
            assert.equal(registeredDelegator[2], transcoder1, "transcoder address incorrect")
        })
    })

    describe("updateTranscoderFeePool", async () => {
        const transcoder = accounts[1]
        const delegator = accounts[2]

        // Transcoder rates
        const blockRewardCut = 10
        const feeShare = 5
        const pricePerSegment = 10

        // Mock fees params
        const fees = 300
        const claimBlock = 100
        const transcoderTotalStake = 1000

        // Bonds
        const transcoderBond = 2000
        const delegatorBond = 2000

        before(async () => {
            await setup()

            // Distribute tokens
            await token.transfer(transcoder, 100000, {from: minter})
            await token.transfer(delegator, 100000, {from: minter})

            await roundsManager.setCurrentRoundInitialized(true)

            // Register transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: transcoder})

            // Transcoder bonds
            await token.approve(bondingManager.address, 2000, {from: transcoder})
            await bondingManager.bond(2000, transcoder, {from: transcoder})

            // Delegator bonds to transcoder
            await token.approve(bondingManager.address, 2000, {from: delegator})
            await bondingManager.bond(2000, transcoder, {from: delegator})

            await jobsManager.setMockTranscoder(transcoder)
            await jobsManager.setMockFees(fees)
            await jobsManager.setMockClaimBlock(claimBlock)
            await jobsManager.setMockTranscoderTotalStake(transcoderTotalStake)

            // Set active transcoders
            await roundsManager.initializeRound()
        })

        it("should update transcoder's total stake", async () => {
            // Call updateTranscoderFeePool via transaction from JobsManager
            await jobsManager.distributeFees()

            const transcoderTotalStake = await bondingManager.transcoderTotalStake(transcoder)
            assert.equal(transcoderTotalStake, transcoderBond + delegatorBond + fees, "transcoder total stake incorrect")
        })

        it("should update transcoder's bond with fee share", async () => {
            const delegatorsFeeShare = Math.floor((fees * feeShare) / 100)
            const transcoderFeeShare = fees - delegatorsFeeShare + Math.floor((delegatorsFeeShare * transcoderBond) / (transcoderBond + delegatorBond))

            const registeredTranscoder = await bondingManager.transcoders.call(transcoder)
            assert.equal(registeredTranscoder[1], transcoderBond + transcoderFeeShare, "transcoder bond incorrect")
        })
    })

    describe("delegatorStake", async () => {
        const transcoder = accounts[1]
        const delegator = accounts[2]

        // Transcoder rates
        const blockRewardCut = 10
        const feeShare = 5
        const pricePerSegment = 10

        // Mock fees params
        const fees = 300
        const claimBlock = web3.eth.blockNumber + 1000
        const transcoderTotalStake = 4000

        // Bonds
        const transcoderBond = 2000
        const delegatorBond = 2000

        before(async () => {
            await setup()

            // Distribute tokens
            await token.transfer(transcoder, 100000, {from: minter})
            await token.transfer(delegator, 100000, {from: minter})

            await roundsManager.setCurrentRoundInitialized(true)
            await roundsManager.setCurrentRound(5)

            // Register transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: transcoder})

            // Transcoder bonds
            await token.approve(bondingManager.address, transcoderBond, {from: transcoder})
            await bondingManager.bond(transcoderBond, transcoder, {from: transcoder})

            // Delegator bonds to transcoder
            await token.approve(bondingManager.address, delegatorBond, {from: delegator})
            await bondingManager.bond(delegatorBond, transcoder, {from: delegator})

            await jobsManager.setMockTranscoder(transcoder)
            await jobsManager.setMockFees(fees)
            await jobsManager.setMockClaimBlock(claimBlock)
            await jobsManager.setMockTranscoderTotalStake(transcoderTotalStake)

            // Set active transcoders
            await roundsManager.initializeRound()

            // Call updateTranscoderFeePool via transaction from JobsManager
            await jobsManager.distributeFees()
        })

        it("should compute delegator stake with latest fees", async () => {
            const delegatorsFeeShare = Math.floor((fees * feeShare) / 100)
            const delegatorFeeShare = Math.floor((delegatorBond * delegatorsFeeShare) / transcoderTotalStake)
            const delegatorStake = await bondingManager.delegatorStake(delegator)
            assert.equal(delegatorStake, delegatorBond + delegatorFeeShare)
        })
    })
})
