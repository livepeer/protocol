import {contractId} from "../../utils/helpers"
import {constants} from "../../utils/constants"
import BN from "bn.js"
import math from "../helpers/math"

const Controller = artifacts.require("Controller")
const BondingManager = artifacts.require("BondingManager")
const AdjustableRoundsManager = artifacts.require("AdjustableRoundsManager")
const LivepeerToken = artifacts.require("LivepeerToken")

contract("Rewards", accounts => {
    let controller
    let bondingManager
    let roundsManager
    let token

    let transcoder1
    let delegator1
    let delegator2
    let delegator3

    let rewardCut
    let feeShare
    let transcoder1StartStake
    let delegator1StartStake
    let delegator2StartStake
    let delegator3StartStake

    let roundLength

    before(async () => {
        transcoder1 = accounts[0]
        delegator1 = accounts[2]
        delegator2 = accounts[3]
        delegator3 = accounts[4]

        controller = await Controller.deployed()
        await controller.unpause()

        const bondingManagerAddr = await controller.getContract(contractId("BondingManager"))
        bondingManager = await BondingManager.at(bondingManagerAddr)

        const roundsManagerAddr = await controller.getContract(contractId("RoundsManager"))
        roundsManager = await AdjustableRoundsManager.at(roundsManagerAddr)

        const tokenAddr = await controller.getContract(contractId("LivepeerToken"))
        token = await LivepeerToken.at(tokenAddr)

        const transferAmount = (new BN(10)).mul(constants.TOKEN_UNIT)
        await token.transfer(transcoder1, transferAmount, {from: accounts[0]})
        await token.transfer(delegator1, transferAmount, {from: accounts[0]})
        await token.transfer(delegator2, transferAmount, {from: accounts[0]})
        await token.transfer(delegator3, transferAmount, {from: accounts[0]})

        roundLength = await roundsManager.roundLength.call()
        await roundsManager.mineBlocks(roundLength.toNumber() * 1000)
        await roundsManager.initializeRound()

        rewardCut = 50 // 50%
        feeShare = 5 // 5%
        transcoder1StartStake = 1000
        delegator1StartStake = 3000
        delegator2StartStake = 3000
        delegator3StartStake = 3000

        // Register transcoder 1
        await token.approve(bondingManager.address, transcoder1StartStake, {from: transcoder1})
        await bondingManager.bond(transcoder1StartStake, transcoder1, {from: transcoder1})
        await bondingManager.transcoder(rewardCut * constants.PERC_MULTIPLIER, feeShare * constants.PERC_MULTIPLIER, {from: transcoder1})

        // Delegator 1 delegates to transcoder 1
        await token.approve(bondingManager.address, delegator1StartStake, {from: delegator1})
        await bondingManager.bond(delegator1StartStake, transcoder1, {from: delegator1})

        // Delegator 2 delegates to transcoder 1
        await token.approve(bondingManager.address, delegator2StartStake, {from: delegator2})
        await bondingManager.bond(delegator2StartStake, transcoder1, {from: delegator2})

        // Delegator 3 delegates to transcoder 1
        await token.approve(bondingManager.address, delegator3StartStake, {from: delegator3})
        await bondingManager.bond(delegator3StartStake, transcoder1, {from: delegator3})

        await roundsManager.mineBlocks(roundLength.toNumber())
        await roundsManager.initializeRound()
    })

    it("correctly calculates reward shares for delegators and transcoders", async () => {
        const callRewardAndCheckStakes = async () => {
            const calcRewardShare = (startStake, startRewardFactor, endRewardFactor) => {
                return math.precise.percOf(startStake, endRewardFactor, startRewardFactor).sub(startStake)
            }
            const acceptableDelta = constants.TOKEN_UNIT.div(new BN(1000)) // .001

            const t1StartStake = (await bondingManager.getDelegator(transcoder1)).bondedAmount
            const d1StartStake = (await bondingManager.getDelegator(delegator1)).bondedAmount
            const d2StartStake = (await bondingManager.getDelegator(delegator2)).bondedAmount
            const d3StartStake = (await bondingManager.getDelegator(delegator3)).bondedAmount

            await bondingManager.reward({from: transcoder1})

            const currentRound = await roundsManager.currentRound()

            const lastClaimRoundT1 = (await bondingManager.getDelegator(transcoder1)).lastClaimRound
            let startRewardFactor = (await bondingManager.getTranscoderEarningsPoolForRound(transcoder1, lastClaimRoundT1)).cumulativeRewardFactor
            startRewardFactor = startRewardFactor.toString() != "0" ? startRewardFactor : constants.PERC_DIVISOR_PRECISE
            const endRewardFactor = (await bondingManager.getTranscoderEarningsPoolForRound(transcoder1, currentRound)).cumulativeRewardFactor
            const transcoderRewards = (await bondingManager.getTranscoder(transcoder1)).cumulativeRewards

            const expT1RewardShare = calcRewardShare(t1StartStake, startRewardFactor, endRewardFactor).add(transcoderRewards)
            const expD1RewardShare = calcRewardShare(d1StartStake, startRewardFactor, endRewardFactor)
            const expD2RewardShare = calcRewardShare(d2StartStake, startRewardFactor, endRewardFactor)
            const expD3RewardShare = calcRewardShare(d3StartStake, startRewardFactor, endRewardFactor)

            const t1Stake = await bondingManager.pendingStake(transcoder1, currentRound)
            const d1Stake = await bondingManager.pendingStake(delegator1, currentRound)
            const d2Stake = await bondingManager.pendingStake(delegator2, currentRound)
            const d3Stake = await bondingManager.pendingStake(delegator3, currentRound)

            const t1RewardShare = t1Stake.sub(t1StartStake)
            const d1RewardShare = d1Stake.sub(d1StartStake)
            const d2RewardShare = d2Stake.sub(d2StartStake)
            const d3RewardShare = d3Stake.sub(d3StartStake)

            assert.isOk(t1RewardShare.sub(expT1RewardShare).abs().lte(acceptableDelta))
            assert.isOk(d1RewardShare.sub(expD1RewardShare).abs().lte(acceptableDelta))
            assert.isOk(d2RewardShare.sub(expD2RewardShare).abs().lte(acceptableDelta))
            assert.isOk(d3RewardShare.sub(expD3RewardShare).abs().lte(acceptableDelta))
        }

        const claimEarningsAndCheckStakes = async () => {
            const acceptableDelta = constants.TOKEN_UNIT.div(new BN(1000)) // .001

            const currentRound = await roundsManager.currentRound()

            const t1StartStake = await bondingManager.pendingStake(transcoder1, currentRound)
            const d1StartStake = await bondingManager.pendingStake(delegator1, currentRound)
            const d2StartStake = await bondingManager.pendingStake(delegator2, currentRound)
            const d3StartStake = await bondingManager.pendingStake(delegator3, currentRound)

            await bondingManager.claimEarnings(currentRound, {from: transcoder1})
            await bondingManager.claimEarnings(currentRound, {from: delegator1})
            await bondingManager.claimEarnings(currentRound, {from: delegator2})
            await bondingManager.claimEarnings(currentRound, {from: delegator3})


            const t1Stake = (await bondingManager.getDelegator(transcoder1)).bondedAmount
            const d1Stake = (await bondingManager.getDelegator(delegator1)).bondedAmount
            const d2Stake = (await bondingManager.getDelegator(delegator2)).bondedAmount
            const d3Stake = (await bondingManager.getDelegator(delegator3)).bondedAmount

            assert.isOk(t1Stake.sub(t1StartStake).abs().lte(acceptableDelta))
            assert.isOk(d1Stake.sub(d1StartStake).abs().lte(acceptableDelta))
            assert.isOk(d2Stake.sub(d2StartStake).abs().lte(acceptableDelta))
            assert.isOk(d3Stake.sub(d3StartStake).abs().lte(acceptableDelta))
        }

        await callRewardAndCheckStakes()
        await roundsManager.mineBlocks(roundLength)
        await roundsManager.initializeRound()

        await callRewardAndCheckStakes()

        // Check reward accounting after calling claimEarnings
        await claimEarningsAndCheckStakes()

        await roundsManager.mineBlocks(roundLength)
        await roundsManager.initializeRound()

        await callRewardAndCheckStakes()

        // Check reward accounting after calling claimEarnings
        // Order should not matter - transcoder can claim in the middle
        await claimEarningsAndCheckStakes()

        await roundsManager.mineBlocks(roundLength)
        await roundsManager.initializeRound()

        await callRewardAndCheckStakes()

        // Check reward accounting after calling claimEarnings
        // Order should not matter - transcoder can claim last
        await claimEarningsAndCheckStakes()
    })
})
