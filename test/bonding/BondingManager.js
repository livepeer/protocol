import Fixture from "../helpers/fixture"
import expectThrow from "../helpers/expectThrow"
import {add, sub} from "../../utils/bn_util"

const BondingManager = artifacts.require("BondingManager")

const NUM_ACTIVE_TRANSCODERS = 1
const UNBONDING_PERIOD = 2

contract("BondingManager", accounts => {
    let fixture
    let bondingManager

    before(async () => {
        fixture = new Fixture(web3)
        await fixture.deployController()
        await fixture.deployMocks()

        bondingManager = await BondingManager.new(fixture.controller.address)
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("initialize", () => {
        it("should set parameters", async () => {
            await bondingManager.initialize(UNBONDING_PERIOD, NUM_ACTIVE_TRANSCODERS)

            const unbondingPeriod = await bondingManager.unbondingPeriod.call()
            assert.equal(unbondingPeriod, UNBONDING_PERIOD, "unbondiner period incorrect")
        })

        it("should fail if already initialized", async () => {
            await bondingManager.initialize(UNBONDING_PERIOD, NUM_ACTIVE_TRANSCODERS)
            await expectThrow(bondingManager.initialize(UNBONDING_PERIOD, NUM_ACTIVE_TRANSCODERS))
        })
    })

    describe("transcoder", () => {
        const tAddr = accounts[1]
        const blockRewardCut = 10
        const feeShare = 5
        const pricePerSegment = 10

        beforeEach(async () => {
            await bondingManager.initialize(UNBONDING_PERIOD, NUM_ACTIVE_TRANSCODERS)
            await fixture.roundsManager.setCurrentRoundInitialized(true)
        })

        it("should throw if round is not initialized", async () => {
            await fixture.roundsManager.setCurrentRoundInitialized(false)
            await expectThrow(bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr}))
        })

        it("should fail if blockRewardCut > 100", async () => {
            const invalidBlockRewardCut = 101
            await expectThrow(bondingManager.transcoder(invalidBlockRewardCut, feeShare, pricePerSegment, {from: tAddr}))
        })

        it("should fail if feeShare > 100", async () => {
            const invalidFeeShare = 101
            await expectThrow(bondingManager.transcoder(blockRewardCut, invalidFeeShare, pricePerSegment, {from: tAddr}))
        })

        it("should create a new transcoder with 0 stake when it has no stake or delegators", async () => {
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr})

            const tBlockRewardCut = await bondingManager.getTranscoderPendingBlockRewardCut(tAddr)
            const tFeeShare = await bondingManager.getTranscoderPendingFeeShare(tAddr)
            const tPricePerSegment = await bondingManager.getTranscoderPendingPricePerSegment(tAddr)
            assert.equal(tBlockRewardCut, blockRewardCut, "pending block reward cut incorrect")
            assert.equal(tFeeShare, feeShare, "pending fee share incorrect")
            assert.equal(tPricePerSegment, pricePerSegment, "pending price per segment incorrect")

            const transcoderTotalStake = await bondingManager.transcoderTotalStake(tAddr)
            assert.equal(transcoderTotalStake, 0, "transcoder total stake incorrecet")
        })

        it("should create a new transcoder with delegated stake", async () => {
            await fixture.token.setApproved(true)
            await bondingManager.bond(2000, tAddr, {from: accounts[2]})

            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr})

            const transcoderTotalStake = await bondingManager.transcoderTotalStake(tAddr)
            assert.equal(transcoderTotalStake, 2000, "transcoder total stake incorrect")
        })

        it("should update a transcoder's config if it is already registered", async () => {
            await fixture.roundsManager.setCurrentRoundInitialized(true)
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr})

            // Update transcoder config
            const newBlockRewardCut = 15
            const newFeeShare = 20
            const newPricePerSegment = 40
            await bondingManager.transcoder(newBlockRewardCut, newFeeShare, newPricePerSegment, {from: tAddr})

            const tBlockRewardCut = await bondingManager.getTranscoderPendingBlockRewardCut(tAddr)
            const tFeeShare = await bondingManager.getTranscoderPendingFeeShare(tAddr)
            const tPricePerSegment = await bondingManager.getTranscoderPendingPricePerSegment(tAddr)
            assert.equal(tBlockRewardCut, newBlockRewardCut, "pending block reward cut incorrect")
            assert.equal(tFeeShare, newFeeShare, "pending fee share incorrect")
            assert.equal(tPricePerSegment, newPricePerSegment, "pending price per segment incorrect")
        })
    })

    describe("resignAsTranscoder", () => {
        const tAddr = accounts[1]

        beforeEach(async () => {
            const blockRewardCut = 10
            const feeShare = 5
            const pricePerSegment = 100

            await bondingManager.initialize(UNBONDING_PERIOD, NUM_ACTIVE_TRANSCODERS)
            await fixture.roundsManager.setCurrentRoundInitialized(true)
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr})
        })

        it("should throw if current round is not initialized", async () => {
            await fixture.roundsManager.setCurrentRoundInitialized(false)
            await expectThrow(bondingManager.resignAsTranscoder({from: tAddr}))
        })

        it("should throw if transcoder is not registered", async () => {
            await expectThrow(bondingManager.resignAsTranscoder({from: accounts[2]}))
        })

        it("should set delegator withdraw round", async () => {
            const currentRound = 100
            await fixture.roundsManager.setCurrentRound(currentRound)

            const unbondingPeriod = await bondingManager.unbondingPeriod.call()
            const withdrawRound = add(currentRound, unbondingPeriod).toString()

            await bondingManager.resignAsTranscoder({from: tAddr})
            const tWithdrawRound = await bondingManager.getTranscoderDelegatorWithdrawRound(tAddr)
            assert.equal(tWithdrawRound, withdrawRound, "withdraw round is incorrect")
        })

        it("should remove the transcoder from the transcoder pools", async () => {
            const oldCandidatePoolSize = await bondingManager.getCandidatePoolSize()

            await bondingManager.resignAsTranscoder({from: tAddr})
            const candidatePoolSize = await bondingManager.getCandidatePoolSize()
            assert.equal(candidatePoolSize.toString(), sub(oldCandidatePoolSize, 1).toString(), "transcoder not removed from pools")
        })

        it("should set a transcoder as resigned", async () => {
            await bondingManager.resignAsTranscoder({from: tAddr})
            const transcoderStatus = await bondingManager.transcoderStatus(tAddr)
            assert.equal(transcoderStatus, 2, "transcoder is not resigned")
        })
    })

    describe("bond", () => {
        const tAddr0 = accounts[1]
        const tAddr1 = accounts[2]
        const dAddr = accounts[3]

        beforeEach(async () => {
            const blockRewardCut = 10
            const feeShare = 5
            const pricePerSegment = 10

            await bondingManager.initialize(UNBONDING_PERIOD, NUM_ACTIVE_TRANSCODERS)
            await fixture.roundsManager.setCurrentRoundInitialized(true)
            await fixture.roundsManager.setCurrentRound(99)
            await fixture.token.setApproved(true)

            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr0})
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr1})
        })

        it("should set delegate and increase bonded stake and delegation amount", async () => {
            await bondingManager.bond(100, tAddr0, {from: dAddr})

            const dBondedAmount = await bondingManager.getDelegatorBondedAmount(dAddr)
            const dDelegate = await bondingManager.getDelegatorDelegateAddress(dAddr)
            assert.equal(dBondedAmount, 100, "bonded amount incorrect")
            assert.equal(dDelegate, tAddr0, "delegate address incorrect")

            const tDelegatedAmount = await bondingManager.getDelegatorDelegatedAmount(tAddr0)
            assert.equal(tDelegatedAmount, 100, "delegated amount incorrect")
        })

        it("should update start round when moving bond", async () => {
            await bondingManager.bond(100, tAddr0, {from: dAddr})
            await fixture.roundsManager.setCurrentRound(100)

            await bondingManager.bond(0, tAddr1, {from: dAddr})
            const dStartRound = await bondingManager.getDelegatorStartRound(dAddr)
            assert.equal(dStartRound, 101, "start round incorrect")
        })
    })

    describe("updateTranscoderWithFees", async () => {
        const tAddr = accounts[1]
        const dAddr = accounts[2]

        // Transcoder rates
        const blockRewardCut = 10
        const feeShare = 5
        const pricePerSegment = 10

        // Mock fees params
        const fees = 300
        const jobCreationRound = 6
        const currentRound = 7

        beforeEach(async () => {
            await bondingManager.initialize(UNBONDING_PERIOD, NUM_ACTIVE_TRANSCODERS)
            await fixture.jobsManager.setBondingManager(bondingManager.address)
            await fixture.roundsManager.setBondingManager(bondingManager.address)
            await fixture.roundsManager.setCurrentRoundInitialized(true)
            await fixture.roundsManager.setCurrentRound(5)
            await fixture.token.setApproved(true)

            // Register transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr})

            // Transcoder bonds
            await bondingManager.bond(2000, tAddr, {from: tAddr})
            // Delegator bonds to transcoder
            await bondingManager.bond(2000, tAddr, {from: dAddr})

            await fixture.jobsManager.setDistributeFeesParams(tAddr, fees, jobCreationRound)

            // Set active transcoders
            await fixture.roundsManager.setCurrentRound(jobCreationRound)
            await fixture.roundsManager.initializeRound()
            await fixture.jobsManager.callElectActiveTranscoder(pricePerSegment)
            await fixture.roundsManager.setCurrentRound(currentRound)
        })

        it("should update transcoder's unbonded amount with fee share", async () => {
            // Call updateTranscoderWithFees via transaction from JobsManager
            await fixture.jobsManager.distributeFees()

            const expUnbondedAmount = Math.floor((fees * (100 - feeShare)) / 100)
            const unbondedAmount = await bondingManager.getDelegatorUnbondedAmount(tAddr)
            assert.equal(unbondedAmount, expUnbondedAmount, "transcoder unbonded amount incorrect")
        })

        it("should only add claimable fees to the fee pool for a round", async () => {
            // Delegator unbonds and claims fee pool share before fees are distributed
            await bondingManager.unbond({from: dAddr})
            // Call updateTranscoderWithFees via transaction from JobsManager
            await fixture.jobsManager.distributeFees()

            const delegatorsFeeShare = Math.floor((fees * feeShare) / 100)
            const expFeePool = Math.floor((2000 * delegatorsFeeShare) / 4000)
            const feePool = await bondingManager.getTranscoderFeePoolForRound(tAddr, jobCreationRound)
            assert.equal(feePool, expFeePool, "transcoder fee pool incorrect")
        })
    })

    describe("claimTokenPoolsShares", async () => {
        const tAddr = accounts[1]
        const dAddr = accounts[2]

        // Transcoder rates
        const blockRewardCut = 10
        const feeShare = 5
        const pricePerSegment = 10

        // Mock distribute fees params
        const fees = 300
        const jobCreationRound = 6
        const transcoderTotalStake = 4000

        // Mock reward params
        const mintedTokens = 500

        beforeEach(async () => {
            await bondingManager.initialize(UNBONDING_PERIOD, NUM_ACTIVE_TRANSCODERS)
            await fixture.jobsManager.setBondingManager(bondingManager.address)
            await fixture.roundsManager.setBondingManager(bondingManager.address)
            await fixture.roundsManager.setCurrentRoundInitialized(true)
            await fixture.roundsManager.setCurrentRound(5)
            await fixture.token.setApproved(true)

            // Register transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr})

            // Transcoder bonds
            await bondingManager.bond(2000, tAddr, {from: tAddr})
            // Delegator bonds to transcoder
            await bondingManager.bond(2000, tAddr, {from: dAddr})

            // Set active transcoders
            await fixture.roundsManager.initializeRound()
            // Set the current round to jobCreationRound
            await fixture.roundsManager.setCurrentRound(jobCreationRound)
            // Set the totalStake for the fee pool at jobCreationRound
            await fixture.jobsManager.callElectActiveTranscoder(pricePerSegment)

            // Set params for distribute fees
            await fixture.jobsManager.setDistributeFeesParams(tAddr, fees, jobCreationRound)

            // Set current round so delegator is bonded
            await fixture.roundsManager.setCurrentRound(7)

            // Call updateTranscoderFeePool via transaction from JobsManager. Fee pool at jobCreationRound updated with fees
            await fixture.jobsManager.distributeFees()

            // Set minted tokens for a call to reward
            await fixture.minter.setReward(mintedTokens)

            // Transcoder calls reward
            await bondingManager.reward({from: tAddr})
        })

        it("should update the delegator's stake and unbonded amount through the end round", async () => {
            // 15
            const delegatorsFeeShare = Math.floor((fees * feeShare) / 100)
            // 7
            const delegatorFeeShare = Math.floor((2000 * delegatorsFeeShare) / transcoderTotalStake)
            // 450
            const delegatorsRewardShare = Math.floor((mintedTokens * (100 - blockRewardCut)) / 100)
            // 225
            const delegatorRewardShare = Math.floor((2000 * delegatorsRewardShare) / transcoderTotalStake)

            const expDelegatorStake = add(2000, delegatorRewardShare).toString()
            const expUnbondedAmount = delegatorFeeShare
            await bondingManager.claimTokenPoolsShares(7, {from: dAddr})

            const delegatorStake = await bondingManager.getDelegatorBondedAmount(dAddr)
            assert.equal(delegatorStake.toString(), expDelegatorStake, "delegator stake incorrect")
            const unbondedAmount = await bondingManager.getDelegatorUnbondedAmount(dAddr)
            assert.equal(unbondedAmount.toString(), expUnbondedAmount, "delegator unbonded amount incorrect")
        })

        it("should throw if the end round is the same as lastClaimTokenPoolsSharesRound", async () => {
            await bondingManager.claimTokenPoolsShares(7, {from: dAddr})
            await expectThrow(bondingManager.claimTokenPoolsShares(7, {from: dAddr}))
        })

        it("should update delegator's stake and unbonded amount through the end round when there are multiple token pools to claim from in a round", async () => {
            const transcoderTotalStake2 = 4000 + mintedTokens
            const fees2 = 400
            const mintedTokens2 = 600
            const jobCreationRound2 = 8

            // Set active transcoders
            await fixture.roundsManager.initializeRound()
            // Set current round to jobCreationRound2
            await fixture.roundsManager.setCurrentRound(jobCreationRound2)
            // Set the totalStake for the fee pool at jobCreationRound2
            await fixture.jobsManager.callElectActiveTranscoder(pricePerSegment)

            // Set params for distribute fees
            await fixture.jobsManager.setDistributeFeesParams(tAddr, fees2, jobCreationRound2)

            // Call updateTranscoderFeePool via transaction from JobsManager. Fee pool at jobCreationRound2 updated with fees2
            await fixture.jobsManager.distributeFees()

            // Set minted tokens for a call to reward
            await fixture.minter.setReward(mintedTokens2)

            // Transcoder calls reward
            await bondingManager.reward({from: tAddr})

            // 15
            const delegatorsFeeShare1 = Math.floor((fees * feeShare) / 100)
            // 7
            const delegatorFeeShare1 = Math.floor((2000 * delegatorsFeeShare1) / transcoderTotalStake)

            // 450
            const delegatorsRewardShare1 = Math.floor((mintedTokens * (100 - blockRewardCut)) / 100)
            // 225
            const delegatorRewardShare1 = Math.floor((2000 * delegatorsRewardShare1) / transcoderTotalStake)

            // 20
            const delegatorsFeeShare2 = Math.floor((fees2 * feeShare) / 100)
            // 9
            const delegatorFeeShare2 = Math.floor((add(2000, delegatorRewardShare1) * delegatorsFeeShare2) / transcoderTotalStake2)

            // 540
            const delegatorsRewardShare2 = Math.floor((mintedTokens2 * (100 - blockRewardCut)) / 100)
            // 267
            const delegatorRewardShare2 = Math.floor((add(2000, delegatorRewardShare1).toNumber() * delegatorsRewardShare2) / transcoderTotalStake2)

            // 2492
            const expDelegatorStake = add(2000, delegatorRewardShare1, delegatorRewardShare2).toString()
            // 18
            const expUnbondedAmount = add(delegatorFeeShare1, delegatorFeeShare2).toString()
            await bondingManager.claimTokenPoolsShares(8, {from: dAddr})

            const delegatorStake = await bondingManager.getDelegatorBondedAmount(dAddr)
            assert.equal(delegatorStake.toString(), expDelegatorStake, "delegator stake incorrect")
            const unbondedAmount = await bondingManager.getDelegatorUnbondedAmount(dAddr)
            assert.equal(unbondedAmount.toString(), expUnbondedAmount, "delegator unbonded amount incorrect")
        })
    })

    describe("delegatorStake", async () => {
        const tAddr = accounts[1]
        const dAddr = accounts[2]

        // Transcoder rates
        const blockRewardCut = 10
        const feeShare = 5
        const pricePerSegment = 10

        const mintedTokens = 500
        const transcoderTotalStake = 4000

        beforeEach(async () => {
            await bondingManager.initialize(UNBONDING_PERIOD, NUM_ACTIVE_TRANSCODERS)
            await fixture.jobsManager.setBondingManager(bondingManager.address)
            await fixture.roundsManager.setBondingManager(bondingManager.address)
            await fixture.roundsManager.setCurrentRoundInitialized(true)
            await fixture.roundsManager.setCurrentRound(5)
            await fixture.token.setApproved(true)

            // Register transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr})

            // Transcoder bonds
            await bondingManager.bond(2000, tAddr, {from: tAddr})
            // Delegator bonds to transcoder
            await bondingManager.bond(2000, tAddr, {from: dAddr})

            // Set active transcoders
            await fixture.roundsManager.initializeRound()

            // Set current round so delegator is bonded
            await fixture.roundsManager.setCurrentRound(7)

            // Set minted tokens for a call to reward
            await fixture.minter.setReward(mintedTokens)

            // Transcoder calls reward
            await bondingManager.reward({from: tAddr})
        })

        it("should compute delegator's stake with latest rewards", async () => {
            const delegatorsRewardShare = Math.floor((mintedTokens * (100 - blockRewardCut)) / 100)
            const delegatorRewardShare = Math.floor((2000 * delegatorsRewardShare) / transcoderTotalStake)
            const expDelegatorStake = add(2000, delegatorRewardShare).toString()
            const delegatorStake = await bondingManager.delegatorStake(dAddr)
            assert.equal(delegatorStake.toString(), expDelegatorStake, "delegator stake incorrect")
        })
    })

    describe("delegatorUnbondedAmount", () => {
        const tAddr = accounts[1]
        const dAddr = accounts[2]

        // Transcoder rates
        const blockRewardCut = 10
        const feeShare = 5
        const pricePerSegment = 10

        // Mock distribute fees params
        const fees = 300
        const jobCreationRound = 6
        const transcoderTotalStake = 4000

        beforeEach(async () => {
            await bondingManager.initialize(UNBONDING_PERIOD, NUM_ACTIVE_TRANSCODERS)
            await fixture.jobsManager.setBondingManager(bondingManager.address)
            await fixture.roundsManager.setBondingManager(bondingManager.address)
            await fixture.roundsManager.setCurrentRoundInitialized(true)
            await fixture.roundsManager.setCurrentRound(5)
            await fixture.token.setApproved(true)

            // Register transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr})

            // Transcoder bonds
            await bondingManager.bond(2000, tAddr, {from: tAddr})
            // Delegator bonds to transcoder
            await bondingManager.bond(2000, tAddr, {from: dAddr})

            // Set active transcoders
            await fixture.roundsManager.initializeRound()
            await fixture.roundsManager.setCurrentRound(jobCreationRound)
            await fixture.jobsManager.callElectActiveTranscoder(pricePerSegment)

            await fixture.jobsManager.setDistributeFeesParams(tAddr, fees, jobCreationRound)

            // Set current round so delegator is bonded
            await fixture.roundsManager.setCurrentRound(7)

            // Call updateTranscoderWithFees via transaction from JobsManager
            await fixture.jobsManager.distributeFees()
        })

        it("should compute delegator's unbonded amount with latest fees", async () => {
            const delegatorsFeeShare = Math.floor((fees * feeShare) / 100)
            const delegatorFeeShare = Math.floor((2000 * delegatorsFeeShare) / transcoderTotalStake)
            const expUnbondedAmount = delegatorFeeShare
            const unbondedAmount = await bondingManager.delegatorUnbondedAmount(dAddr)
            assert.equal(unbondedAmount, expUnbondedAmount, "delegator unbonded amount incorrect")
        })
    })
})
