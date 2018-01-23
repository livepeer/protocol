import Fixture from "../helpers/fixture"
import expectThrow from "../helpers/expectThrow"
import {add} from "../../utils/bn_util"

const BondingManager = artifacts.require("BondingManager")

const NUM_TRANSCODERS = 2
const NUM_ACTIVE_TRANSCODERS = 1
const UNBONDING_PERIOD = 2

const PERC_DIVISOR = 1000000
const PERC_MULTIPLIER = PERC_DIVISOR / 100

contract("BondingManager", accounts => {
    let fixture
    let bondingManager

    before(async () => {
        fixture = new Fixture(web3)
        await fixture.deployController()
        await fixture.deployMocks()

        bondingManager = await fixture.deployAndRegister(BondingManager, "BondingManager", fixture.controller.address)
        fixture.bondingManager = bondingManager
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("set parameters", () => {
        it("should set parameters", async () => {
            await bondingManager.setParameters(UNBONDING_PERIOD, NUM_TRANSCODERS, NUM_ACTIVE_TRANSCODERS)

            const unbondingPeriod = await bondingManager.unbondingPeriod.call()
            assert.equal(unbondingPeriod, UNBONDING_PERIOD, "unbonding period incorrect")
        })
    })

    describe("transcoder", () => {
        const tAddr = accounts[1]
        const blockRewardCut = 10 * PERC_MULTIPLIER
        const feeShare = 5 * PERC_MULTIPLIER
        const pricePerSegment = 10

        beforeEach(async () => {
            await bondingManager.setParameters(UNBONDING_PERIOD, NUM_TRANSCODERS, NUM_ACTIVE_TRANSCODERS)
            await fixture.roundsManager.setCurrentRoundInitialized(true)
        })

        it("should fail if the current round is locked", async () => {
            await fixture.roundsManager.setCurrentRoundLocked(true)
            await expectThrow(bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment), {from: tAddr})
        })

        it("should fail if transcoder is not bonded to self", async () => {
            await fixture.token.setApproved(true)
            await bondingManager.bond(2000, tAddr, {from: accounts[2]})

            // Fails because transcoder has non zero delegated stake but is not bonded to self
            await expectThrow(bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment), {from: tAddr})
        })

        it("should fail if transcoder does not have a non-zero amount bonded to self", async () => {
            await bondingManager.bond(0, tAddr, {from: tAddr})

            // Fails because transcoder is delegated to self but has zero bonded stake
            await expectThrow(bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment), {from: tAddr})
        })

        it("should fail if blockRewardCut is an invalid percentage", async () => {
            const invalidBlockRewardCut = 101 * PERC_MULTIPLIER
            await expectThrow(bondingManager.transcoder(invalidBlockRewardCut, feeShare, pricePerSegment, {from: tAddr}))
        })

        it("should fail if feeShare > 100", async () => {
            const invalidFeeShare = 101 * PERC_MULTIPLIER
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
            const newBlockRewardCut = 15 * PERC_MULTIPLIER
            const newFeeShare = 20 * PERC_MULTIPLIER
            const newPricePerSegment = 40
            await bondingManager.transcoder(newBlockRewardCut, newFeeShare, newPricePerSegment, {from: tAddr})

            const tInfo = await bondingManager.getTranscoder(tAddr)
            assert.equal(tInfo[4], newBlockRewardCut, "pending block reward cut incorrect")
            assert.equal(tInfo[5], newFeeShare, "pending fee share incorrect")
            assert.equal(tInfo[6], newPricePerSegment, "pending price per segment incorrect")
        })
    })

    describe("bond", () => {
        const tAddr0 = accounts[1]
        const tAddr1 = accounts[2]
        const dAddr = accounts[3]

        beforeEach(async () => {
            const blockRewardCut = 10 * PERC_MULTIPLIER
            const feeShare = 5 * PERC_MULTIPLIER
            const pricePerSegment = 10

            await bondingManager.setParameters(UNBONDING_PERIOD, NUM_TRANSCODERS, NUM_ACTIVE_TRANSCODERS)

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

        it("should set delegate and increase bonded stake and delegation amount and total bonded", async () => {
            await bondingManager.bond(100, tAddr0, {from: dAddr})

            const dInfo = await bondingManager.getDelegator(dAddr)
            const dBondedAmount = dInfo[0]
            const dDelegate = dInfo[2]
            assert.equal(dBondedAmount, 100, "bonded amount incorrect")
            assert.equal(dDelegate, tAddr0, "delegate address incorrect")

            const tDInfo = await bondingManager.getDelegator(tAddr0)
            const tDelegatedAmount = tDInfo[3]
            assert.equal(tDelegatedAmount, 200, "delegated amount incorrect")

            const totalBonded = await bondingManager.getTotalBonded()
            assert.equal(totalBonded, 300, "total bonded incorrect")
        })

        it("should update start round when moving bond", async () => {
            await bondingManager.bond(100, tAddr0, {from: dAddr})
            await fixture.roundsManager.setCurrentRound(100)

            await bondingManager.bond(0, tAddr1, {from: dAddr})
            const dInfo = await bondingManager.getDelegator(dAddr)
            const dStartRound = dInfo[4]
            assert.equal(dStartRound, 101, "start round incorrect")
        })
    })

    describe("updateTranscoderWithFees", async () => {
        const tAddr = accounts[1]
        const dAddr = accounts[2]

        // Transcoder rates
        const blockRewardCut = 10 * PERC_MULTIPLIER
        const feeShare = 5 * PERC_MULTIPLIER
        const pricePerSegment = 10

        // Mock fees params
        const fees = 300
        const jobCreationRound = 6
        const currentRound = 7

        beforeEach(async () => {
            await bondingManager.setParameters(UNBONDING_PERIOD, NUM_TRANSCODERS, NUM_ACTIVE_TRANSCODERS)

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
        const blockRewardCut = 10 * PERC_MULTIPLIER
        const feeShare = 5 * PERC_MULTIPLIER
        const pricePerSegment = 10

        // Mock distribute fees params
        const fees = 300
        const jobCreationRound = 7
        const transcoderTotalStake = 4000

        // Mock reward params
        const mintedTokens = 500

        beforeEach(async () => {
            await bondingManager.setParameters(UNBONDING_PERIOD, NUM_TRANSCODERS, NUM_ACTIVE_TRANSCODERS)

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
            // Set the current round to jobCreationRound
            await fixture.roundsManager.setCurrentRound(jobCreationRound)
            await fixture.roundsManager.initializeRound()

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
            const delegatorsFeeShare = Math.floor((fees * feeShare) / PERC_DIVISOR)
            // 7
            const delegatorFeeShare = Math.floor((2000 * delegatorsFeeShare) / transcoderTotalStake)
            // 450
            const delegatorsRewardShare = Math.floor((mintedTokens * (PERC_DIVISOR - blockRewardCut)) / PERC_DIVISOR)
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
            const delegatorsFeeShare = Math.floor((fees * feeShare) / PERC_DIVISOR)
            // 7
            const delegatorFeeShare = Math.floor((2000 * delegatorsFeeShare) / transcoderTotalStake)
            // 285
            const transcoderFeeShare = fees - delegatorsFeeShare
            // 450
            const delegatorsRewardShare = Math.floor((mintedTokens * (PERC_DIVISOR - blockRewardCut)) / PERC_DIVISOR)
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

            // Set params for distribute fees
            await fixture.jobsManager.setDistributeFeesParams(tAddr, fees2, jobCreationRound2)

            // Call updateTranscoderFeePool via transaction from JobsManager. Fee pool at jobCreationRound2 updated with fees2
            await fixture.jobsManager.distributeFees()

            // Set minted tokens for a call to reward
            await fixture.minter.setReward(mintedTokens2)

            // Transcoder calls reward
            await bondingManager.reward({from: tAddr})

            const percPoints1 = Math.floor((2000 * PERC_DIVISOR) / transcoderTotalStake)
            const transcoderFeeShare1 = Math.floor((fees * (PERC_DIVISOR - feeShare)) / PERC_DIVISOR)
            const delegatorsFeeShare1 = fees - transcoderFeeShare1
            const delegatorFeeShare1 = Math.floor((percPoints1 * delegatorsFeeShare1) / PERC_DIVISOR)
            const transcoderRewardShare1 = Math.floor((mintedTokens * blockRewardCut) / PERC_DIVISOR)
            const delegatorsRewardShare1 = mintedTokens - transcoderRewardShare1
            const delegatorRewardShare1 = Math.floor((percPoints1 * delegatorsRewardShare1) / PERC_DIVISOR)

            const percPoints2 = Math.floor((add(2000, delegatorRewardShare1) * PERC_DIVISOR) / transcoderTotalStake2)
            const transcoderFeeShare2 = Math.floor((fees2 * (PERC_DIVISOR - feeShare)) / PERC_DIVISOR)
            const delegatorsFeeShare2 = fees2 - transcoderFeeShare2
            const delegatorFeeShare2 = Math.floor((percPoints2 * delegatorsFeeShare2) / PERC_DIVISOR)
            const transcoderRewardShare2 = Math.floor((mintedTokens2 * blockRewardCut) / PERC_DIVISOR)
            const delegatorsRewardShare2 = mintedTokens2 - transcoderRewardShare2
            const delegatorRewardShare2 = Math.floor((percPoints2 * delegatorsRewardShare2) / PERC_DIVISOR)

            const expDelegatorStake = add(2000, delegatorRewardShare1, delegatorRewardShare2)
            const expUnbondedAmount = add(delegatorFeeShare1, delegatorFeeShare2)
            await bondingManager.claimTokenPoolsShares(8, {from: dAddr})

            const dInfo = await bondingManager.getDelegator(dAddr)
            assert.equal(dInfo[0].toString(), expDelegatorStake, "delegator stake incorrect")
            assert.equal(dInfo[1].toString(), expUnbondedAmount, "delegator unbonded amount incorrect")
        })

        it("should update delegator's stake and unbonded amount through the end round with a larger portion of rewards and fees after another delegator unbonds before the rewards and fees are released", async () => {
            const transcoderTotalStake2 = 6000 + mintedTokens
            const fees2 = 400
            const mintedTokens2 = 600
            const jobCreationRound2 = 8
            const dAddr2 = accounts[3]

            // Delegator 2 bonds
            await bondingManager.bond(2000, tAddr, {from: dAddr2})

            await fixture.roundsManager.setCurrentRound(jobCreationRound2)
            await fixture.roundsManager.initializeRound()

            // Delegator 1 claims shares through round 7
            await bondingManager.claimTokenPoolsShares(7, {from: dAddr})
            // Delegator 2 claims shares through round 8
            await bondingManager.claimTokenPoolsShares(jobCreationRound2, {from: dAddr2})

            // Calculate current claimable stake
            let claimableStake = transcoderTotalStake2 - 2000

            let tokenPools = await bondingManager.getTranscoderTokenPoolsForRound(tAddr, jobCreationRound2)
            assert.equal(tokenPools[3], claimableStake, "wrong claimable stake for token pools")

            // Set params for distribute fees
            await fixture.jobsManager.setDistributeFeesParams(tAddr, fees2, jobCreationRound2)
            // Call updateTranscoderFeePool via transaction from JobsManager. Fee pool at jobCreationRound2 updated with fees2
            await fixture.jobsManager.distributeFees()
            // Set minted tokens for a call to reward
            await fixture.minter.setReward(mintedTokens2)
            // Transcoder calls reward
            await bondingManager.reward({from: tAddr})

            // Get Delegator 1 current stake
            const delegatorStake = (await bondingManager.getDelegator(dAddr))[0]
            // Get Delegator 1 unbonded amount
            const unbondedAmount = (await bondingManager.getDelegator(dAddr))[1]

            const percPoints = Math.floor((delegatorStake * PERC_DIVISOR) / claimableStake)
            const transcoderFeeShare = Math.floor((fees2 * (PERC_DIVISOR - feeShare)) / PERC_DIVISOR)
            const delegatorsFeeShare = fees2 - transcoderFeeShare
            const delegatorFeeShare = Math.floor((percPoints * delegatorsFeeShare) / PERC_DIVISOR)
            const transcoderRewardShare = Math.floor((mintedTokens2 * blockRewardCut) / PERC_DIVISOR)
            const delegatorsRewardShare = mintedTokens2 - transcoderRewardShare
            const delegatorRewardShare = Math.floor((percPoints * delegatorsRewardShare) / PERC_DIVISOR)

            const expDelegatorStake = add(delegatorStake, delegatorRewardShare).toString()
            const expUnbondedAmount = add(unbondedAmount, delegatorFeeShare).toString()

            await bondingManager.claimTokenPoolsShares(jobCreationRound2, {from: dAddr})

            const dInfo = await bondingManager.getDelegator(dAddr)
            assert.equal(dInfo[0].toString(), expDelegatorStake, "delegator stake incorrect")
            assert.equal(dInfo[1].toString(), expUnbondedAmount, "delegator unbonded amount incorrect")

            claimableStake -= delegatorStake
            tokenPools = await bondingManager.getTranscoderTokenPoolsForRound(tAddr, jobCreationRound2)
            assert.equal(tokenPools[0], mintedTokens2 - delegatorRewardShare, "wrong reward pool for token pools")
            assert.equal(tokenPools[1], fees2 - delegatorFeeShare, "wrong fee pool for token pools")
            assert.equal(tokenPools[3], claimableStake, "wrong claimable stake for token pools")

            await bondingManager.claimTokenPoolsShares(jobCreationRound2, {from: tAddr})
            tokenPools = await bondingManager.getTranscoderTokenPoolsForRound(tAddr, jobCreationRound2)
            assert.equal(tokenPools[0], 0, "wrong reward pool for token pools")
            assert.equal(tokenPools[1], 0, "wrong fee pool for token pools")
            assert.equal(tokenPools[3], 0, "wrong claimable stake for token pools")
        })
    })

    describe("pendingStake", async () => {
        const tAddr = accounts[1]
        const dAddr = accounts[2]

        // Transcoder rates
        const blockRewardCut = 10 * PERC_MULTIPLIER
        const feeShare = 5 * PERC_MULTIPLIER
        const pricePerSegment = 10

        const mintedTokens = 500
        const transcoderTotalStake = 4000

        beforeEach(async () => {
            await bondingManager.setParameters(UNBONDING_PERIOD, NUM_TRANSCODERS, NUM_ACTIVE_TRANSCODERS)

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
            const delegatorsRewardShare = Math.floor((mintedTokens * (PERC_DIVISOR - blockRewardCut)) / PERC_DIVISOR)
            const delegatorRewardShare = Math.floor((2000 * delegatorsRewardShare) / transcoderTotalStake)
            const expDelegatorStake = add(2000, delegatorRewardShare).toString()
            const pendingStake = await bondingManager.pendingStake(dAddr)
            assert.equal(pendingStake.toString(), expDelegatorStake, "delegator stake incorrect")
        })
    })

    describe("pendingFees", () => {
        const tAddr = accounts[1]
        const dAddr = accounts[2]

        // Transcoder rates
        const blockRewardCut = 10 * PERC_MULTIPLIER
        const feeShare = 5 * PERC_MULTIPLIER
        const pricePerSegment = 10

        // Mock distribute fees params
        const fees = 300
        const jobCreationRound = 7
        const transcoderTotalStake = 4000

        beforeEach(async () => {
            await bondingManager.setParameters(UNBONDING_PERIOD, NUM_TRANSCODERS, NUM_ACTIVE_TRANSCODERS)

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

            await fixture.jobsManager.setDistributeFeesParams(tAddr, fees, jobCreationRound)

            // Call updateTranscoderWithFees via transaction from JobsManager
            await fixture.jobsManager.distributeFees()
        })

        it("should compute delegator's collected fees with latest fee shares", async () => {
            const delegatorsFeeShare = Math.floor((fees * feeShare) / PERC_DIVISOR)
            const delegatorFeeShare = Math.floor((2000 * delegatorsFeeShare) / transcoderTotalStake)
            const expFees = delegatorFeeShare
            const dFees = await bondingManager.pendingFees(dAddr)
            assert.equal(dFees, expFees, "delegator fees incorrect")
        })
    })

    describe("unbond", () => {
        const tAddr = accounts[1]
        const dAddr = accounts[2]

        // Transcoder rates
        const blockRewardCut = 10 * PERC_MULTIPLIER
        const feeShare = 5 * PERC_MULTIPLIER
        const pricePerSegment = 10

        const currentRound = 6

        beforeEach(async () => {
            await bondingManager.setParameters(UNBONDING_PERIOD, NUM_TRANSCODERS, NUM_ACTIVE_TRANSCODERS)

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

            // Set current round so delegator is bonded
            await fixture.roundsManager.setCurrentRound(currentRound)
            // Set active transcoders
            await fixture.roundsManager.initializeRound()
        })

        it("should set withdraw round to current block + unbonding period", async () => {
            const unbondingPeriod = await bondingManager.unbondingPeriod.call()
            const expWithdrawRound = unbondingPeriod.add(currentRound)
            await bondingManager.unbond({from: dAddr})

            const dInfo = await bondingManager.getDelegator(dAddr)
            assert.equal(dInfo[5], expWithdrawRound.toNumber(), "withdraw round incorrect")
        })

        it("should reduce total bonded", async () => {
            const startTotalBonded = await bondingManager.getTotalBonded()
            await bondingManager.unbond({from: dAddr})
            const endTotalBonded = await bondingManager.getTotalBonded()
            assert.equal(startTotalBonded.sub(endTotalBonded), 2000, "total bonded incorrect")
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

        it("should resign transcoder if caller is a registered transcoder", async () => {
            await bondingManager.unbond({from: tAddr})

            assert.equal(await bondingManager.transcoderStatus(tAddr), 0, "transcoder not removed from pool")
        })

        it("should set transcoder as inactive for the current round if caller is a registered transcoder", async () => {
            assert.isOk(await bondingManager.isActiveTranscoder(tAddr, currentRound), "transcoder should be active")

            await bondingManager.unbond({from: tAddr})

            assert.isNotOk(await bondingManager.isActiveTranscoder(tAddr, currentRound), "transcoder should be inactive")
        })
    })

    describe("withdrawStake", () => {
        const tAddr = accounts[1]
        const dAddr = accounts[2]

        // Transcoder rates
        const blockRewardCut = 10 * PERC_MULTIPLIER
        const feeShare = 5 * PERC_MULTIPLIER
        const pricePerSegment = 10

        // Mock distribute fees params
        const jobCreationRound = 7

        beforeEach(async () => {
            await bondingManager.setParameters(UNBONDING_PERIOD, NUM_TRANSCODERS, NUM_ACTIVE_TRANSCODERS)

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

        it("should throw if delegator is not yet unbonded", async () => {
            await expectThrow(bondingManager.withdrawStake({from: dAddr}))
        })

        it("should withdraw bonded tokens", async () => {
            await bondingManager.unbond({from: dAddr})
            const unbondingPeriod = await bondingManager.unbondingPeriod.call()
            await fixture.roundsManager.setCurrentRound(7 + unbondingPeriod.toNumber())
            const expWithdrawAmount = 2000

            const startDInfo = await bondingManager.getDelegator(dAddr)
            const startBondedAmount = startDInfo[0]
            await bondingManager.withdrawStake({from: dAddr})
            const endDInfo = await bondingManager.getDelegator(dAddr)
            const endBondedAmount = endDInfo[0]
            assert.equal(startBondedAmount.sub(endBondedAmount).toNumber(), expWithdrawAmount, "withdraw amount incorrect")
        })

        it("should set withdraw round to 0", async () => {
            await bondingManager.unbond({from: dAddr})
            const unbondingPeriod = await bondingManager.unbondingPeriod.call()
            await fixture.roundsManager.setCurrentRound(7 + unbondingPeriod.toNumber())

            await bondingManager.withdrawStake({from: dAddr})

            const dInfo = await bondingManager.getDelegator(dAddr)
            assert.equal(dInfo[5], 0, "delegator withdraw round not set to 0")
        })
    })

    describe("withdrawFees", () => {
        const tAddr = accounts[1]
        const dAddr = accounts[2]

        // Transcoder rates
        const blockRewardCut = 10 * PERC_MULTIPLIER
        const feeShare = 5 * PERC_MULTIPLIER
        const pricePerSegment = 10

        // Mock distribute fees params
        const fees = 300
        const jobCreationRound = 7
        const transcoderTotalStake = 4000

        beforeEach(async () => {
            await bondingManager.setParameters(UNBONDING_PERIOD, NUM_TRANSCODERS, NUM_ACTIVE_TRANSCODERS)

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

        it("should throw if delegator has no fees", async () => {
            await expectThrow(bondingManager.withdrawFees({from: dAddr}))
        })

        it("should withdraw unbonded amount", async () => {
            await fixture.jobsManager.setDistributeFeesParams(tAddr, fees, jobCreationRound)

            // Call updateTranscoderWithFees via transaction from JobsManager
            await fixture.jobsManager.distributeFees()

            const delegatorsFeeShare = Math.floor((fees * feeShare) / PERC_DIVISOR)
            const delegatorFeeShare = Math.floor((2000 * delegatorsFeeShare) / transcoderTotalStake)
            const expWithdrawAmount = delegatorFeeShare

            await bondingManager.claimTokenPoolsShares(7, {from: dAddr})
            const startDInfo = await bondingManager.getDelegator(dAddr)
            const startUnbondedAmount = startDInfo[1]
            await bondingManager.withdrawFees({from: dAddr})
            const endDInfo = await bondingManager.getDelegator(dAddr)
            const endUnbondedAmount = endDInfo[1]
            assert.equal(startUnbondedAmount.sub(endUnbondedAmount).toNumber(), expWithdrawAmount, "withdraw amount incorrect")
        })
    })
})
