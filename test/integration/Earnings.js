import BN from "bn.js"

const {constants} = require("../../utils/constants")
const {contractId} = require("../../utils/helpers")
const executeLIP36Upgrade = require("../helpers/executeLIP36Upgrade")
import {createWinningTicket, getTicketHash} from "../helpers/ticket"
import signMsg from "../helpers/signMsg"
import math from "../helpers/math"
import { assert } from "chai"
import truffleAssert from "truffle-assertions"

const Controller = artifacts.require("Controller")
const BondingManagerPreLIP36 = artifacts.require("BondingManagerPreLIP36")
const AdjustableRoundsManager = artifacts.require("AdjustableRoundsManager")
const LivepeerToken = artifacts.require("LivepeerToken")
const TicketBroker = artifacts.require("TicketBroker")

const LinkedList = artifacts.require("SortedDoublyLL")

const ManagerProxy = artifacts.require("ManagerProxy")

contract("Earnings", accounts => {
    let controller
    let bondingManager
    let bondingProxy
    let roundsManager
    let token
    let broker

    const transcoder = accounts[0]
    const broadcaster = accounts[1]
    const delegator = accounts[2]
    const transcoder2 = accounts[3]

    const rewardCut = 50 * constants.PERC_MULTIPLIER // 50%
    const feeShare = 25 * constants.PERC_MULTIPLIER // 25%

    const transcoderStake = 1000
    const delegatorStake = 3000

    let roundLength

    const NUM_ACTIVE_TRANSCODERS = 2
    const UNBONDING_PERIOD = 2
    const MAX_EARNINGS_CLAIMS_ROUNDS = 20

    const PERC_DIVISOR = 1000000

    const faceValue = new BN(web3.utils.toWei("0.1", "ether")).toString() // 0.1 ETH

    async function redeemWinningTicket(transcoder, broadcaster, faceValue) {
        const block = await roundsManager.blockNum()
        const creationRound = (await roundsManager.currentRound()).toString()
        const creationRoundBlockHash = await roundsManager.blockHash(block)
        const auxData = web3.eth.abi.encodeParameters(
            ["uint256", "bytes32"],
            [creationRound, creationRoundBlockHash]
        )
        const recipientRand = 5
        const ticket = createWinningTicket(transcoder, broadcaster, recipientRand, faceValue, auxData)
        const senderSig = await signMsg(getTicketHash(ticket), broadcaster)

        await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: transcoder})
    }

    before(async () => {
        controller = await Controller.deployed()
        await controller.unpause()

        const ll = await LinkedList.new()
        BondingManagerPreLIP36.link("SortedDoublyLL", ll.address)
        const bondingTarget = await BondingManagerPreLIP36.new(controller.address)
        await controller.setContractInfo(contractId("BondingManagerTarget"), bondingTarget.address, web3.utils.asciiToHex("0x123"))
        bondingProxy = await ManagerProxy.new(controller.address, contractId("BondingManagerTarget"))
        await controller.setContractInfo(contractId("BondingManager"), bondingProxy.address, web3.utils.asciiToHex("0x123"))
        bondingManager = await BondingManagerPreLIP36.at(bondingProxy.address)

        await bondingManager.setUnbondingPeriod(UNBONDING_PERIOD)
        await bondingManager.setNumActiveTranscoders(NUM_ACTIVE_TRANSCODERS)
        await bondingManager.setMaxEarningsClaimsRounds(MAX_EARNINGS_CLAIMS_ROUNDS)

        const roundsManagerAddr = await controller.getContract(contractId("RoundsManager"))
        roundsManager = await AdjustableRoundsManager.at(roundsManagerAddr)

        const tokenAddr = await controller.getContract(contractId("LivepeerToken"))
        token = await LivepeerToken.at(tokenAddr)

        const brokerAddr = await controller.getContract(contractId("JobsManager"))
        broker = await TicketBroker.at(brokerAddr)

        // transfer tokens to transcoder and delegator
        const amount = new BN(10).mul(constants.TOKEN_UNIT)
        await token.transfer(transcoder, amount, {from: accounts[0]})
        await token.transfer(delegator, amount, {from: accounts[0]})

        roundLength = await roundsManager.roundLength.call()
        await roundsManager.mineBlocks(roundLength.toNumber() * 10)
        await roundsManager.setBlockHash(web3.utils.keccak256("foo"))
        await roundsManager.initializeRound()

        // Register transcoder
        await token.approve(bondingManager.address, transcoderStake, {from: transcoder})
        await bondingManager.bond(transcoderStake, transcoder, {from: transcoder})
        await bondingManager.transcoder(rewardCut, feeShare, {from: transcoder})

        // Delegate from delegator
        await token.approve(bondingManager.address, delegatorStake, {from: delegator})
        await bondingManager.bond(delegatorStake, transcoder, {from: delegator})

        const deposit = new BN(web3.utils.toWei("5", "ether"))
        await broker.fundDeposit({from: broadcaster, value: deposit})
        const reserve = new BN(web3.utils.toWei("5", "ether"))
        await broker.fundReserve({from: broadcaster, value: reserve})
    })

    const getStake = async addr => {
        const currentRound = await roundsManager.currentRound()
        const d = await bondingManager.getDelegator(addr)

        if (d.lastClaimRound.toNumber() < currentRound.toNumber()) {
            return await bondingManager.pendingStake(addr, currentRound)
        } else {
            return d.bondedAmount
        }
    }

    const getFees = async addr => {
        const currentRound = await roundsManager.currentRound()
        const d = await bondingManager.getDelegator(addr)

        if (d.lastClaimRound.toNumber() < currentRound.toNumber()) {
            return await bondingManager.pendingFees(addr, currentRound)
        } else {
            return d.fees
        }
    }

    const oldEarningsAndCheck = async () => {
        const acceptableDelta = constants.TOKEN_UNIT.div(new BN(1000)) // .001

        const transcoderStartStake = await getStake(transcoder)
        const delegatorStartStake = await getStake(delegator)
        const totalStartStake = transcoderStartStake.add(delegatorStartStake)

        const transcoderStartFees = await getFees(transcoder)
        const delegatorStartFees = await getFees(delegator)

        await bondingManager.reward({from: transcoder})
        await redeemWinningTicket(transcoder, broadcaster, faceValue)

        const currentRound = await roundsManager.currentRound()

        const earningsPool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound)
        const delegatorRewardPool = earningsPool.rewardPool
        const transcoderRewardPool = earningsPool.transcoderRewardPool
        const delegatorFeePool = earningsPool.feePool
        const transcoderFeePool = earningsPool.transcoderFeePool

        const expTRewardShare = delegatorRewardPool.mul(transcoderStartStake).div(totalStartStake).add(transcoderRewardPool)
        const expDRewardShare = delegatorRewardPool.mul(delegatorStartStake).div(totalStartStake)
        const expTFees = delegatorFeePool.mul(transcoderStartStake).div(totalStartStake).add(transcoderFeePool)
        const expDFees = delegatorFeePool.mul(delegatorStartStake).div(totalStartStake)

        const transcoderEndStake = await bondingManager.pendingStake(transcoder, currentRound)
        const delegatorEndStake = await bondingManager.pendingStake(delegator, currentRound)
        const transcoderEndFees = await bondingManager.pendingFees(transcoder, currentRound)
        const delegatorEndFees = await bondingManager.pendingFees(delegator, currentRound)

        const transcoderRewardShare = transcoderEndStake.sub(transcoderStartStake)
        const delegatorRewardShare = delegatorEndStake.sub(delegatorStartStake)
        const transcoderFees = transcoderEndFees.sub(transcoderStartFees)
        const delegatorFees = delegatorEndFees.sub(delegatorStartFees)

        assert.isOk(transcoderRewardShare.sub(expTRewardShare).abs().lte(acceptableDelta))
        assert.isOk(delegatorRewardShare.sub(expDRewardShare).abs().lte(acceptableDelta))
        assert.isOk(transcoderFees.sub(expTFees).abs().lte(acceptableDelta))
        assert.isOk(delegatorFees.sub(expDFees).abs().lte(acceptableDelta))
    }

    const cumulativeEarningsAndCheck = async () => {
        const acceptableDelta = new BN(0)

        const calcRewardShare = (startStake, startRewardFactor, endRewardFactor) => {
            return math.percOf(startStake, endRewardFactor, startRewardFactor).sub(startStake)
        }

        const calcFeeShare = (startStake, startFeeFactor, endFeeFactor, startRewardFactor) => {
            return math.percOf(
                startStake,
                endFeeFactor.sub(startFeeFactor),
                startRewardFactor
            )
        }

        const transcoderDel = await bondingManager.getDelegator(transcoder)
        const delegatorDel = await bondingManager.getDelegator(delegator)
        let transcoderStartStake = transcoderDel.bondedAmount
        let delegatorStartStake = delegatorDel.bondedAmount
        let transcoderStartFees = transcoderDel.fees
        let delegatorStartFees = delegatorDel.fees

        const lastClaimRoundTranscoder = transcoderDel.lastClaimRound

        await bondingManager.reward({from: transcoder})
        await redeemWinningTicket(transcoder, broadcaster, faceValue)

        const LIP36Round = await roundsManager.lipUpgradeRound(36)
        let LIP36EarningsPool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, LIP36Round)
        if (lastClaimRoundTranscoder.cmp(LIP36Round) <= 0) {
            let round = LIP36EarningsPool.hasTranscoderRewardFeePool ? LIP36Round : LIP36Round.sub(new BN(1))
            transcoderStartStake = await bondingManager.pendingStake(transcoder, round)
            delegatorStartStake = await bondingManager.pendingStake(delegator, round)
            transcoderStartFees = await bondingManager.pendingFees(transcoder, round)
            delegatorStartFees = await bondingManager.pendingFees(delegator, round)
        }

        const currentRound = await roundsManager.currentRound()

        const transC = await bondingManager.getTranscoder(transcoder)
        const startEarningsPool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, lastClaimRoundTranscoder)
        let startRewardFactor = startEarningsPool.cumulativeRewardFactor
        startRewardFactor = startRewardFactor.gt(new BN(0)) ? startRewardFactor : new BN(PERC_DIVISOR)

        const startFeeFactor = startEarningsPool.cumulativeFeeFactor
        const endEarningsPool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound)
        let endRewardFactor = endEarningsPool.cumulativeRewardFactor
        if (endRewardFactor.eq(new BN(0))) {
            let lastRewFactor = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, transC.lastRewardRound)
            lastRewFactor = lastRewFactor.gt(new BN(0)) ? lastRewFactor : new BN(PERC_DIVISOR)
            endRewardFactor = lastRewFactor
        }

        const endFeeFactor = endEarningsPool.cumulativeFeeFactor.gt(new BN(0)) ? endEarningsPool.cumulativeFeeFactor : (await bondingManager.getTranscoderEarningsPoolForRound(transcoder, transC.lastFeeRound)).cumulativeFeeFactor
        const transcoderRewards = transC.cumulativeRewards
        const transcoderFees = transC.cumulativeFees

        const expTranscoderRewardShare = calcRewardShare(transcoderStartStake, startRewardFactor, endRewardFactor).add(transcoderRewards)
        const expDelegatorRewardShare = calcRewardShare(delegatorStartStake, startRewardFactor, endRewardFactor)
        const expTranscoderFeeShare = calcFeeShare(transcoderStartStake, startFeeFactor, endFeeFactor, startRewardFactor).add(transcoderFees)
        const expDelegatorFeeShare = calcFeeShare(delegatorStartStake, startFeeFactor, endFeeFactor, startRewardFactor)

        const transcoderEndStake = await bondingManager.pendingStake(transcoder, currentRound)
        const delegatorEndStake = await bondingManager.pendingStake(delegator, currentRound)
        const transcoderEndFees = await bondingManager.pendingFees(transcoder, currentRound)
        const delegatorEndFees = await bondingManager.pendingFees(delegator, currentRound)

        const transcoderRewardShare = transcoderEndStake.sub(transcoderStartStake)
        const delegatorRewardShare = delegatorEndStake.sub(delegatorStartStake)
        const transcoderFeeShare = transcoderEndFees.sub(transcoderStartFees)
        const delegatorFeeShare = delegatorEndFees.sub(delegatorStartFees)

        assert.isOk(transcoderRewardShare.sub(expTranscoderRewardShare).abs().lte(acceptableDelta))
        assert.isOk(delegatorRewardShare.sub(expDelegatorRewardShare).abs().lte(acceptableDelta))
        assert.isOk(transcoderFeeShare.sub(expTranscoderFeeShare).abs().lte(acceptableDelta))
        assert.isOk(delegatorFeeShare.sub(expDelegatorFeeShare).abs().lte(acceptableDelta))
    }

    const claimEarningsAndCheckStakes = async () => {
        const acceptableDelta = constants.TOKEN_UNIT.div(new BN(1000)) // .001

        const currentRound = await roundsManager.currentRound()

        const transcoderStartStake = await getStake(transcoder)
        const delegatorStartStake = await getStake(delegator)
        const transcoderStartFees = await getFees(transcoder)
        const delegatorStartFees = await getFees(delegator)

        await bondingManager.claimEarnings(currentRound, {from: transcoder})
        await bondingManager.claimEarnings(currentRound, {from: delegator})


        const transcoderDel = await bondingManager.getDelegator(transcoder)
        const delegatorDel = await bondingManager.getDelegator(delegator)
        const transcoderEndStake = transcoderDel.bondedAmount
        const delegatorEndStake = delegatorDel.bondedAmount
        const transcoderEndFees = transcoderDel.fees
        const delegatorEndFees = delegatorDel.fees
        assert.isOk(transcoderEndStake.sub(transcoderStartStake).abs().lte(acceptableDelta))
        assert.isOk(delegatorEndStake.sub(delegatorStartStake).abs().lte(acceptableDelta))
        assert.isOk(transcoderEndFees.sub(transcoderStartFees).abs().lte(acceptableDelta))
        assert.isOk(delegatorEndFees.sub(delegatorStartFees).abs().lte(acceptableDelta))
        assert.equal(transcoderDel.lastClaimRound.toString(), currentRound.toString())
        assert.equal(delegatorDel.lastClaimRound.toString(), currentRound.toString())
    }

    describe("earnings before LIP-36", async () => {
        beforeEach(async () => {
            await roundsManager.mineBlocks(roundLength.toNumber())
            await roundsManager.initializeRound()
        })

        it("calculates earnings for one round before LIP-36", async () => {
            await oldEarningsAndCheck()
        })

        it("calculates earnings for two rounds before LIP-36", async () => {
            await oldEarningsAndCheck()
        })

        it("claims earnings for rounds before LIP-36", async () => {
            await claimEarningsAndCheckStakes()
        })
    })

    describe("earnings before and after LIP-36 combined", async () => {
        beforeEach(async () => {
            await roundsManager.mineBlocks(roundLength.toNumber())
            await roundsManager.initializeRound()
        })

        it("calculates earnings before LIP-36", async () => {
            await oldEarningsAndCheck()
        })

        it("calculates earnings and deploys LIP-36", async () => {
            await oldEarningsAndCheck()
            bondingManager = await executeLIP36Upgrade(controller, roundsManager, bondingProxy.address)
        })

        it("calculates earnings after LIP-36", async () => {
            await cumulativeEarningsAndCheck()
        })

        it("claims earnings for rounds before and after LIP-36 combined", async () => {
            await claimEarningsAndCheckStakes()
        })
    })

    describe("earnings after LIP-36", async () => {
        it("calculates earnings after LIP-36 for multiple rounds", async () => {
            for (let i = 0; i < 10; i++) {
                await roundsManager.mineBlocks(roundLength.toNumber())
                await roundsManager.initializeRound()
                await cumulativeEarningsAndCheck()
            }
        })

        it("claims earnings after LIP-36", async () => {
            await claimEarningsAndCheckStakes()
        })

        it("calculates earnings after LIP-36 when a delegator moves stake to a transcoder that did not call reward in current round", async () => {
            // Register and activate transcoder
            // Ensure that transcoder2 earns rewards by giving it the same stake as transcoder
            const amount = await getStake(transcoder)
            await token.transfer(transcoder2, amount, {from: accounts[0]})
            await token.approve(bondingManager.address, amount, {from: transcoder2})
            await bondingManager.bond(amount, transcoder2, {from: transcoder2})
            await bondingManager.transcoder(rewardCut, feeShare, {from: transcoder2})

            await roundsManager.mineBlocks(roundLength.toNumber())
            await roundsManager.initializeRound()

            await bondingManager.reward({from: transcoder2})
            await redeemWinningTicket(transcoder2, broadcaster, faceValue)

            const cr = await roundsManager.currentRound()
            const initialPool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder2, cr)

            await roundsManager.mineBlocks(roundLength.toNumber())
            await roundsManager.initializeRound()

            await bondingManager.bond(0, transcoder2, {from: delegator})

            await bondingManager.reward({from: transcoder})
            // No reward call from transcoder2

            const startStake = await getStake(delegator)
            const startFees = await getFees(delegator)
            
            await roundsManager.mineBlocks(roundLength.toNumber())
            await roundsManager.initializeRound()

            const endStake = await getStake(delegator)
            const endFees = await getFees(delegator)

            const t2Stake = await getStake(transcoder2)

            const del = await bondingManager.getDelegator(delegator)
            const lastClaimPool = await bondingManager.getTranscoderEarningsPoolForRound(del.delegateAddress, del.lastClaimRound)

            assert.equal(startStake.toString(), endStake.toString(), "invalid stake")
            assert.equal(startFees.toString(), endFees.toString(), "invalid fees")
            assert.equal(lastClaimPool.cumulativeRewardFactor.toString(), initialPool.cumulativeRewardFactor.toString(), "invalid cumulative reward factor")
            assert.equal(lastClaimPool.cumulativeFeeFactor.toString(), initialPool.cumulativeFeeFactor.toString(), "invalid cumulative fee factor")

            // transcoder 2 should still be able to unbond and withdraw all funds
            await bondingManager.unbond(t2Stake, {from: transcoder2})
            await bondingManager.unbond(endStake, {from: delegator})

            await roundsManager.mineBlocks(roundLength.toNumber() * UNBONDING_PERIOD)
            await roundsManager.initializeRound()

            assert.ok(await Promise.all([
                bondingManager.withdrawStake(0, {from: transcoder2}),
                bondingManager.withdrawStake(0, {from: delegator}),
                bondingManager.withdrawFees({from: transcoder2}),
                bondingManager.withdrawFees({from: delegator})
            ]))
        })

        it("calculates earnings after LIP-36 when a delegator bonds from unbonded to a transcoder that did not call reward in the current round", async () => {
            // New delegator 
            const delegator4 = accounts[4]
            const amount = 5000
            await token.transfer(delegator4, 5000, {from: accounts[0]})

            await roundsManager.mineBlocks(roundLength.toNumber())
            await roundsManager.initializeRound()

            // call reward for transcoder and get initial earnings pool
            await bondingManager.reward({from: transcoder})
            await redeemWinningTicket(transcoder, broadcaster, faceValue)

            const cr = await roundsManager.currentRound()
            const initialPool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, cr)

            await roundsManager.mineBlocks(roundLength.toNumber())
            await roundsManager.initializeRound()

            // bond to transcoder
            await token.approve(bondingManager.address, amount, {from: delegator4})
            await bondingManager.bond(amount, transcoder, {from: delegator4})

            // no reward call from transcoder in this round 

            const startStake = await getStake(delegator4)
            const startFees = await getFees(delegator4)
            
            await roundsManager.mineBlocks(roundLength.toNumber())
            await roundsManager.initializeRound()

            const endStake = await getStake(delegator4)
            const endFees = await getFees(delegator4)

            const tStake = await getStake(transcoder)

            const del = await bondingManager.getDelegator(delegator4)
            const lastClaimPool = await bondingManager.getTranscoderEarningsPoolForRound(del.delegateAddress, del.lastClaimRound)

            assert.equal(startStake.toString(), endStake.toString(), "invalid stake")
            assert.equal(startFees.toString(), endFees.toString(), "invalid fees")
            assert.equal(lastClaimPool.cumulativeRewardFactor.toString(), initialPool.cumulativeRewardFactor.toString(), "invalid cumulative reward factor")
            assert.equal(lastClaimPool.cumulativeFeeFactor.toString(), initialPool.cumulativeFeeFactor.toString(), "invalid cumulative fee factor")

            // transcoder 2 should still be able to unbond and withdraw all funds
            await bondingManager.unbond(tStake, {from: transcoder})
            await bondingManager.unbond(endStake, {from: delegator4})

            await roundsManager.mineBlocks(roundLength.toNumber() * UNBONDING_PERIOD)
            await roundsManager.initializeRound()

            assert.ok(await Promise.all([
                bondingManager.withdrawStake(0, {from: transcoder}),
                bondingManager.withdrawStake(0, {from: delegator4}),
                bondingManager.withdrawFees({from: transcoder}),
            ]))

            // delegator hasn't earned fees so should revert
            truffleAssert.reverts(
                bondingManager.withdrawFees({from: delegator4}),
                "no fees to withdraw"
            )
        })
    })
})
