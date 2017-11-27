import Fixture from "../helpers/fixture"
import expectThrow from "../helpers/expectThrow"
import {add} from "../../utils/bn_util"

const BondingManager = artifacts.require("BondingManager")

const NUM_TRANSCODERS = 2
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
            await bondingManager.initialize(UNBONDING_PERIOD, NUM_TRANSCODERS, NUM_ACTIVE_TRANSCODERS)

            const unbondingPeriod = await bondingManager.unbondingPeriod.call()
            assert.equal(unbondingPeriod, UNBONDING_PERIOD, "unbonding period incorrect")
        })

        it("should fail if already initialized", async () => {
            await bondingManager.initialize(UNBONDING_PERIOD, NUM_TRANSCODERS, NUM_ACTIVE_TRANSCODERS)
            await expectThrow(bondingManager.initialize(UNBONDING_PERIOD, NUM_TRANSCODERS, NUM_ACTIVE_TRANSCODERS))
        })
    })

    describe("transcoder", () => {
        const tAddr = accounts[1]
        const blockRewardCut = 10
        const feeShare = 5
        const pricePerSegment = 10

        beforeEach(async () => {
            await bondingManager.initialize(UNBONDING_PERIOD, NUM_TRANSCODERS, NUM_ACTIVE_TRANSCODERS)
            await fixture.roundsManager.setCurrentRoundInitialized(true)
        })

        it("should throw if round is not initialized", async () => {
            await fixture.roundsManager.setCurrentRoundInitialized(false)
            await expectThrow(bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr}))
        })

        it("should fail with zero delegated amount", async () => {
            await expectThrow(bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment), {from: tAddr})
        })

        it("should fail if blockRewardCut > 100", async () => {
            const invalidBlockRewardCut = 101
            await expectThrow(bondingManager.transcoder(invalidBlockRewardCut, feeShare, pricePerSegment, {from: tAddr}))
        })

        it("should fail if feeShare > 100", async () => {
            const invalidFeeShare = 101
            await expectThrow(bondingManager.transcoder(blockRewardCut, invalidFeeShare, pricePerSegment, {from: tAddr}))
        })

        it("should create a new transcoder with delegated stake", async () => {
            await fixture.token.setApproved(true)
            await bondingManager.bond(2000, tAddr, {from: tAddr})

            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr})

            const tInfo = await bondingManager.getTranscoder(tAddr)
            assert.equal(tInfo[4], blockRewardCut, "pending block reward cut incorrect")
            assert.equal(tInfo[5], feeShare, "pending fee share incorrect")
            assert.equal(tInfo[6], pricePerSegment, "pending price per segment incorrect")

            const transcoderTotalStake = await bondingManager.transcoderTotalStake(tAddr)
            assert.equal(transcoderTotalStake, 2000, "transcoder total stake incorrect")
        })

        it("should update a transcoder's config if it is already registered", async () => {
            await fixture.roundsManager.setCurrentRoundInitialized(true)
            await fixture.token.setApproved(true)
            await bondingManager.bond(2000, tAddr, {from: tAddr})
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr})

            // Update transcoder config
            const newBlockRewardCut = 15
            const newFeeShare = 20
            const newPricePerSegment = 40
            await bondingManager.transcoder(newBlockRewardCut, newFeeShare, newPricePerSegment, {from: tAddr})

            const tInfo = await bondingManager.getTranscoder(tAddr)
            assert.equal(tInfo[4], newBlockRewardCut, "pending block reward cut incorrect")
            assert.equal(tInfo[5], newFeeShare, "pending fee share incorrect")
            assert.equal(tInfo[6], newPricePerSegment, "pending price per segment incorrect")
        })
    })

    describe("resignAsTranscoder", () => {
        const tAddr = accounts[1]

        beforeEach(async () => {
            const blockRewardCut = 10
            const feeShare = 5
            const pricePerSegment = 100

            await bondingManager.initialize(UNBONDING_PERIOD, NUM_TRANSCODERS, NUM_ACTIVE_TRANSCODERS)
            await fixture.roundsManager.setCurrentRoundInitialized(true)
            await fixture.token.setApproved(true)
            await bondingManager.bond(2000, tAddr, {from: tAddr})
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr})
        })

        it("should throw if current round is not initialized", async () => {
            await fixture.roundsManager.setCurrentRoundInitialized(false)
            await expectThrow(bondingManager.resignAsTranscoder({from: tAddr}))
        })

        it("should throw if transcoder is not registered", async () => {
            await expectThrow(bondingManager.resignAsTranscoder({from: accounts[2]}))
        })

        it("should remove the transcoder from the transcoder pools", async () => {
            await bondingManager.resignAsTranscoder({from: tAddr})
            assert.equal(await bondingManager.transcoderStatus(tAddr), 0, "transcoder not removed from pool")
        })

        it("should set a transcoder as not registered", async () => {
            await bondingManager.resignAsTranscoder({from: tAddr})
            const transcoderStatus = await bondingManager.transcoderStatus(tAddr)
            assert.equal(transcoderStatus, 0, "transcoder is not not registered")
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

            await bondingManager.initialize(UNBONDING_PERIOD, NUM_TRANSCODERS, NUM_ACTIVE_TRANSCODERS)
            await fixture.jobsManager.setBondingManager(bondingManager.address)
            await fixture.roundsManager.setBondingManager(bondingManager.address)
            await fixture.roundsManager.setCurrentRoundInitialized(true)
            await fixture.roundsManager.setCurrentRound(5)
            await fixture.token.setApproved(true)

            await bondingManager.bond(100, tAddr0, {from: tAddr0})
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr0})
            await bondingManager.bond(100, tAddr1, {from: tAddr1})
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr1})
        })

        it("should set delegate and increase bonded stake and delegation amount", async () => {
            await bondingManager.bond(100, tAddr0, {from: dAddr})

            const dInfo = await bondingManager.getDelegator(dAddr)
            const dBondedAmount = dInfo[0]
            const dDelegate = dInfo[2]
            assert.equal(dBondedAmount, 100, "bonded amount incorrect")
            assert.equal(dDelegate, tAddr0, "delegate address incorrect")

            const tDInfo = await bondingManager.getDelegator(tAddr0)
            const tDelegatedAmount = tDInfo[3]
            assert.equal(tDelegatedAmount, 200, "delegated amount incorrect")
        })

        it("should update start round when moving bond", async () => {
            await bondingManager.bond(100, tAddr0, {from: dAddr})
            await fixture.roundsManager.setCurrentRound(100)

            await bondingManager.bond(0, tAddr1, {from: dAddr})
            const dInfo = await bondingManager.getDelegator(dAddr)
            const dStartRound = dInfo[4]
            assert.equal(dStartRound, 101, "start round incorrect")
        })

        it("should use the unbonded amount if the amount to bond is less than or equal to the unbonded amount", async () => {
            await bondingManager.bond(100, tAddr0, {from: dAddr})

            const fees = 300
            const pricePerSegment = 10
            const jobCreationRound = 6
            const currentRound = 7

            await fixture.jobsManager.setDistributeFeesParams(tAddr0, fees, jobCreationRound)

            // Set active transcoders
            await fixture.roundsManager.setCurrentRound(jobCreationRound)
            await fixture.roundsManager.initializeRound()
            await fixture.jobsManager.callElectActiveTranscoder(pricePerSegment)
            await fixture.roundsManager.setCurrentRound(currentRound)

            // Call updateTranscoderWithFees via transaction from JobsManager
            await fixture.jobsManager.distributeFees()
            // Claim token pool share
            await bondingManager.claimTokenPoolsShares(currentRound, {from: dAddr})

            const startDInfo = await bondingManager.getDelegator(dAddr)
            const startUnbondedAmount = startDInfo[1]
            await bondingManager.bond(15, tAddr0, {from: dAddr})
            const endDInfo = await bondingManager.getDelegator(dAddr)
            const endUnbondedAmount = endDInfo[1]

            assert.equal(startUnbondedAmount.sub(endUnbondedAmount), 7, "unbonded amount used incorrect")

            const bondedAmount = endDInfo[0]
            assert.equal(bondedAmount, 115, "bonded amount incorreect")
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
            await bondingManager.initialize(UNBONDING_PERIOD, NUM_TRANSCODERS, NUM_ACTIVE_TRANSCODERS)
            await fixture.jobsManager.setBondingManager(bondingManager.address)
            await fixture.roundsManager.setBondingManager(bondingManager.address)
            await fixture.roundsManager.setCurrentRoundInitialized(true)
            await fixture.roundsManager.setCurrentRound(5)
            await fixture.token.setApproved(true)

            // Transcoder bonds
            await bondingManager.bond(2000, tAddr, {from: tAddr})

            // Register transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr})

            // Delegator bonds to transcoder
            await bondingManager.bond(2000, tAddr, {from: dAddr})

            await fixture.jobsManager.setDistributeFeesParams(tAddr, fees, jobCreationRound)

            // Set active transcoders
            await fixture.roundsManager.setCurrentRound(jobCreationRound)
            await fixture.roundsManager.initializeRound()
            await fixture.jobsManager.callElectActiveTranscoder(pricePerSegment)
            await fixture.roundsManager.setCurrentRound(currentRound)
        })

        it("should add fees to the fee pool for a round", async () => {
            // Delegator unbonds and claims fee pool share before fees are distributed
            await bondingManager.unbond({from: dAddr})
            // Call updateTranscoderWithFees via transaction from JobsManager
            await fixture.jobsManager.distributeFees()

            const expFeePool = fees
            const tokenPools = await bondingManager.getTranscoderTokenPoolsForRound(tAddr, jobCreationRound)
            const feePool = tokenPools[1]
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
        const jobCreationRound = 7
        const transcoderTotalStake = 4000

        // Mock reward params
        const mintedTokens = 500

        beforeEach(async () => {
            await bondingManager.initialize(UNBONDING_PERIOD, NUM_TRANSCODERS, NUM_ACTIVE_TRANSCODERS)
            await fixture.jobsManager.setBondingManager(bondingManager.address)
            await fixture.roundsManager.setBondingManager(bondingManager.address)
            await fixture.roundsManager.setCurrentRoundInitialized(true)
            await fixture.roundsManager.setCurrentRound(5)
            await fixture.token.setApproved(true)

            // Transcoder bonds
            await bondingManager.bond(2000, tAddr, {from: tAddr})
            // Register transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr})

            // Delegator bonds to transcoder
            await bondingManager.bond(2000, tAddr, {from: dAddr})

            // Set active transcoders
            await fixture.roundsManager.initializeRound()
            await fixture.roundsManager.setCurrentRound(6)
            await fixture.roundsManager.initializeRound()
            // // Set the current round to jobCreationRound
            await fixture.roundsManager.setCurrentRound(jobCreationRound)
            await fixture.roundsManager.initializeRound()
            // Set the totalStake for the fee pool at jobCreationRound
            await fixture.jobsManager.callElectActiveTranscoder(pricePerSegment)

            // Set params for distribute fees
            await fixture.jobsManager.setDistributeFeesParams(tAddr, fees, jobCreationRound)

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

            const dInfo = await bondingManager.getDelegator(dAddr)
            const delegatorStake = dInfo[0]
            assert.equal(delegatorStake.toString(), expDelegatorStake, "delegator stake incorrect")
            const unbondedAmount = dInfo[1]
            assert.equal(unbondedAmount.toString(), expUnbondedAmount, "delegator unbonded amount incorrect")
        })

        it("should update the transcoder's stake and unbonded amount through the end round", async () => {
            // 15
            const delegatorsFeeShare = Math.floor((fees * feeShare) / 100)
            // 7
            const delegatorFeeShare = Math.floor((2000 * delegatorsFeeShare) / transcoderTotalStake)
            // 285
            const transcoderFeeShare = fees - delegatorsFeeShare
            // 450
            const delegatorsRewardShare = Math.floor((mintedTokens * (100 - blockRewardCut)) / 100)
            // 225
            const delegatorRewardShare = Math.floor((2000 * delegatorsRewardShare) / transcoderTotalStake)
            // 50
            const transcoderRewardShare = mintedTokens - delegatorsRewardShare

            const expTranscoderStake = add(2000, delegatorRewardShare, transcoderRewardShare)
            const expUnbondedAmount = add(delegatorFeeShare, transcoderFeeShare)
            await bondingManager.claimTokenPoolsShares(7, {from: tAddr})

            const tDInfo = await bondingManager.getDelegator(tAddr)
            const transcoderStake = tDInfo[0]
            assert.equal(transcoderStake.toString(), expTranscoderStake, "transcoder stake incorrect")
            const unbondedAmount = tDInfo[1]
            assert.equal(unbondedAmount.toString(), expUnbondedAmount, "transcoder unbonded amount incorrect")
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

            // Set current round to jobCreationRound2
            await fixture.roundsManager.setCurrentRound(jobCreationRound2)
            // Set active transcoders
            await fixture.roundsManager.initializeRound()
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

            const dInfo = await bondingManager.getDelegator(dAddr)
            const delegatorStake = dInfo[0]
            assert.equal(delegatorStake.toString(), expDelegatorStake, "delegator stake incorrect")
            const unbondedAmount = dInfo[1]
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
            await bondingManager.initialize(UNBONDING_PERIOD, NUM_TRANSCODERS, NUM_ACTIVE_TRANSCODERS)
            await fixture.jobsManager.setBondingManager(bondingManager.address)
            await fixture.roundsManager.setBondingManager(bondingManager.address)
            await fixture.roundsManager.setCurrentRoundInitialized(true)
            await fixture.roundsManager.setCurrentRound(5)
            await fixture.token.setApproved(true)

            // Transcoder bonds
            await bondingManager.bond(2000, tAddr, {from: tAddr})
            // Register transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr})

            // Delegator bonds to transcoder
            await bondingManager.bond(2000, tAddr, {from: dAddr})

            // Set active transcoders
            await fixture.roundsManager.initializeRound()

            // Set current round so delegator is bonded
            await fixture.roundsManager.setCurrentRound(7)

            // Set active transcoders
            await fixture.roundsManager.initializeRound()

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
        const jobCreationRound = 7
        const transcoderTotalStake = 4000

        beforeEach(async () => {
            await bondingManager.initialize(UNBONDING_PERIOD, NUM_TRANSCODERS, NUM_ACTIVE_TRANSCODERS)
            await fixture.jobsManager.setBondingManager(bondingManager.address)
            await fixture.roundsManager.setBondingManager(bondingManager.address)
            await fixture.roundsManager.setCurrentRoundInitialized(true)
            await fixture.roundsManager.setCurrentRound(5)
            await fixture.token.setApproved(true)

            // Transcoder bonds
            await bondingManager.bond(2000, tAddr, {from: tAddr})
            // Register transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr})

            // Delegator bonds to transcoder
            await bondingManager.bond(2000, tAddr, {from: dAddr})

            // Set active transcoders
            await fixture.roundsManager.setCurrentRound(6)
            await fixture.roundsManager.initializeRound()
            await fixture.roundsManager.setCurrentRound(jobCreationRound)
            await fixture.roundsManager.initializeRound()
            await fixture.jobsManager.callElectActiveTranscoder(pricePerSegment)

            await fixture.jobsManager.setDistributeFeesParams(tAddr, fees, jobCreationRound)

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

    describe("unbond", () => {
        const tAddr = accounts[1]
        const dAddr = accounts[2]

        // Transcoder rates
        const blockRewardCut = 10
        const feeShare = 5
        const pricePerSegment = 10

        const currentRound = 6

        beforeEach(async () => {
            await bondingManager.initialize(UNBONDING_PERIOD, NUM_TRANSCODERS, NUM_ACTIVE_TRANSCODERS)
            await fixture.jobsManager.setBondingManager(bondingManager.address)
            await fixture.roundsManager.setBondingManager(bondingManager.address)
            await fixture.roundsManager.setCurrentRoundInitialized(true)
            await fixture.roundsManager.setCurrentRound(5)
            await fixture.token.setApproved(true)

            // Transcoder bonds
            await bondingManager.bond(2000, tAddr, {from: tAddr})
            // Register transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr})

            // Delegator bonds to transcoder
            await bondingManager.bond(2000, tAddr, {from: dAddr})

            // Set active transcoders
            await fixture.roundsManager.initializeRound()
            // Set current round so delegator is bonded
            await fixture.roundsManager.setCurrentRound(currentRound)
        })

        it("should set withdraw round to current block + unbonding period", async () => {
            const unbondingPeriod = await bondingManager.unbondingPeriod.call()
            const expWithdrawRound = unbondingPeriod.add(currentRound)
            await bondingManager.unbond({from: dAddr})

            const dInfo = await bondingManager.getDelegator(dAddr)
            assert.equal(dInfo[5], expWithdrawRound.toNumber(), "withdraw round incorrect")
        })

        it("should set start round to 0", async () => {
            await bondingManager.unbond({from: dAddr})

            const dInfo = await bondingManager.getDelegator(dAddr)
            assert.equal(dInfo[4], 0, "start round not 0")
        })

        it("should set delegate address to null address", async () => {
            await bondingManager.unbond({from: dAddr})

            const dInfo = await bondingManager.getDelegator(dAddr)
            assert.equal(dInfo[2], "0x0000000000000000000000000000000000000000", "delegate address not null address")
        })

        it("should reduce delegate's delegated amount by bonded amount", async () => {
            const startDelegatedAmount = (await bondingManager.getDelegator(tAddr))[3]
            await bondingManager.unbond({from: dAddr})
            const endDelegatedAmount = (await bondingManager.getDelegator(tAddr))[3]

            assert.equal(startDelegatedAmount.sub(endDelegatedAmount), 2000, "delegate's delegated amount did not decrease by bonded amount")
        })
    })

    describe("withdraw", () => {
        const tAddr = accounts[1]
        const dAddr = accounts[2]

        // Transcoder rates
        const blockRewardCut = 10
        const feeShare = 5
        const pricePerSegment = 10

        // Mock distribute fees params
        const fees = 300
        const jobCreationRound = 7
        const transcoderTotalStake = 4000

        beforeEach(async () => {
            await bondingManager.initialize(UNBONDING_PERIOD, NUM_TRANSCODERS, NUM_ACTIVE_TRANSCODERS)
            await fixture.jobsManager.setBondingManager(bondingManager.address)
            await fixture.roundsManager.setBondingManager(bondingManager.address)
            await fixture.roundsManager.setCurrentRoundInitialized(true)
            await fixture.roundsManager.setCurrentRound(5)
            await fixture.token.setApproved(true)

            // Transcoder bonds
            await bondingManager.bond(2000, tAddr, {from: tAddr})
            // Register transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: tAddr})

            // Delegator bonds to transcoder
            await bondingManager.bond(2000, tAddr, {from: dAddr})

            await fixture.roundsManager.setCurrentRound(6)
            await fixture.roundsManager.initializeRound()
            await fixture.roundsManager.setCurrentRound(jobCreationRound)
            await fixture.roundsManager.initializeRound()
        })

        it("should withdraw unbonded amount", async () => {
            await fixture.jobsManager.callElectActiveTranscoder(pricePerSegment)

            await fixture.jobsManager.setDistributeFeesParams(tAddr, fees, jobCreationRound)

            // Call updateTranscoderWithFees via transaction from JobsManager
            await fixture.jobsManager.distributeFees()

            const delegatorsFeeShare = Math.floor((fees * feeShare) / 100)
            const delegatorFeeShare = Math.floor((2000 * delegatorsFeeShare) / transcoderTotalStake)
            const expWithdrawAmount = delegatorFeeShare

            await bondingManager.claimTokenPoolsShares(7, {from: dAddr})
            const startDInfo = await bondingManager.getDelegator(dAddr)
            const startUnbondedAmount = startDInfo[1]
            await bondingManager.withdraw({from: dAddr})
            const endDInfo = await bondingManager.getDelegator(dAddr)
            const endUnbondedAmount = endDInfo[1]
            assert.equal(startUnbondedAmount.sub(endUnbondedAmount).toNumber(), expWithdrawAmount, "withdraw amount incorrect")
        })

        it("should throw if unbonded amount is zero and bonded tokens are not yet unbonded", async () => {
            await expectThrow(bondingManager.withdraw({from: dAddr}))
        })

        it("should withdraw bonded tokens that are now unbonded", async () => {
            await bondingManager.unbond({from: dAddr})
            const unbondingPeriod = await bondingManager.unbondingPeriod.call()
            await fixture.roundsManager.setCurrentRound(7 + unbondingPeriod.toNumber())
            const expWithdrawAmount = 2000

            const startDInfo = await bondingManager.getDelegator(dAddr)
            const startBondedAmount = startDInfo[0]
            await bondingManager.withdraw({from: dAddr})
            const endDInfo = await bondingManager.getDelegator(dAddr)
            const endBondedAmount = endDInfo[0]
            assert.equal(startBondedAmount.sub(endBondedAmount).toNumber(), expWithdrawAmount, "withdraw amount incorrect")
        })

        it("should withdraw both bonded and unbonded tokens", async () => {
            await fixture.jobsManager.callElectActiveTranscoder(pricePerSegment)

            await fixture.jobsManager.setDistributeFeesParams(tAddr, fees, jobCreationRound)

            // Call updateTranscoderWithFees via transaction from JobsManager
            await fixture.jobsManager.distributeFees()

            const delegatorsFeeShare = Math.floor((fees * feeShare) / 100)
            const delegatorFeeShare = Math.floor((2000 * delegatorsFeeShare) / transcoderTotalStake)

            await bondingManager.unbond({from: dAddr})
            const unbondingPeriod = await bondingManager.unbondingPeriod.call()
            await fixture.roundsManager.setCurrentRound(7 + unbondingPeriod.toNumber())
            const expWithdrawAmount = 2000 + delegatorFeeShare

            const startDInfo = await bondingManager.getDelegator(dAddr)
            const startBondedAmount = startDInfo[0]
            const startUnbondedAmount = startDInfo[1]
            await bondingManager.withdraw({from: dAddr})
            const endDInfo = await bondingManager.getDelegator(dAddr)
            const endBondedAmount = endDInfo[0]
            const endUnbondedAmount = endDInfo[1]
            const bondedWithdrawn = startBondedAmount.sub(endBondedAmount).toNumber()
            const unbondedWithdrawn = startUnbondedAmount.sub(endUnbondedAmount).toNumber()
            assert.equal(bondedWithdrawn + unbondedWithdrawn, expWithdrawAmount, "withdraw amount incorrect")
        })

        it("should set withdraw round to 0", async () => {
            await bondingManager.unbond({from: dAddr})
            const unbondingPeriod = await bondingManager.unbondingPeriod.call()
            await fixture.roundsManager.setCurrentRound(7 + unbondingPeriod.toNumber())

            await bondingManager.withdraw({from: dAddr})

            const dInfo = await bondingManager.getDelegator(dAddr)
            assert.equal(dInfo[5], 0, "delegator withdraw round not set to 0")
        })
    })
})
