import {contractId} from "../../utils/helpers"
import {constants} from "../../utils/constants"
import BigNumber from "bignumber.js"

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

        const transferAmount = new BigNumber(10).times(constants.TOKEN_UNIT)
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
        await bondingManager.transcoder(rewardCut * constants.PERC_MULTIPLIER, feeShare * constants.PERC_MULTIPLIER, 200000000000, {from: transcoder1})

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
        const getStake = async addr => {
            const currentRound = await roundsManager.currentRound()
            const d = await bondingManager.getDelegator(addr)

            if (d[5].toNumber() < currentRound.toNumber()) {
                return await bondingManager.pendingStake(addr, currentRound)
            } else {
                return d[0]
            }
        }

        const callRewardAndCheckStakes = async () => {
            const acceptableDelta = constants.TOKEN_UNIT / 1000 // .001

            const t1StartStake = await getStake(transcoder1)
            const d1StartStake = await getStake(delegator1)
            const d2StartStake = await getStake(delegator2)
            const d3StartStake = await getStake(delegator3)
            const totalStartStake = t1StartStake.add(d1StartStake).add(d2StartStake).add(d3StartStake)

            const expT1RewardPerc = t1StartStake.div(totalStartStake)
            const expD1RewardPerc = d1StartStake.div(totalStartStake)
            const expD2RewardPerc = d2StartStake.div(totalStartStake)
            const expD3RewardPerc = d3StartStake.div(totalStartStake)

            await bondingManager.reward({from: transcoder1})

            const currentRound = await roundsManager.currentRound()
            const earningsPool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder1, currentRound)
            const delegatorRewards = earningsPool[0]
            const transcoderRewards = earningsPool[6]

            const expT1RewardShare = delegatorRewards.mul(expT1RewardPerc).floor().add(transcoderRewards)
            const expD1RewardShare = delegatorRewards.mul(expD1RewardPerc).floor()
            const expD2RewardShare = delegatorRewards.mul(expD2RewardPerc).floor()
            const expD3RewardShare = delegatorRewards.mul(expD3RewardPerc).floor()

            const t1Stake = await getStake(transcoder1)
            const d1Stake = await getStake(delegator1)
            const d2Stake = await getStake(delegator2)
            const d3Stake = await getStake(delegator3)

            const t1RewardShare = t1Stake.sub(t1StartStake)
            const d1RewardShare = d1Stake.sub(d1StartStake)
            const d2RewardShare = d2Stake.sub(d2StartStake)
            const d3RewardShare = d3Stake.sub(d3StartStake)

            assert.isAtMost(t1RewardShare.sub(expT1RewardShare).abs().toNumber(), acceptableDelta)
            assert.isAtMost(d1RewardShare.sub(expD1RewardShare).abs().toNumber(), acceptableDelta)
            assert.isAtMost(d2RewardShare.sub(expD2RewardShare).abs().toNumber(), acceptableDelta)
            assert.isAtMost(d3RewardShare.sub(expD3RewardShare).abs().toNumber(), acceptableDelta)
        }

        const claimEarningsAndCheckStakes = async addr => {
            const acceptableDelta = constants.TOKEN_UNIT / 1000 // .001

            const t1StartStake = await getStake(transcoder1)
            const d1StartStake = await getStake(delegator1)
            const d2StartStake = await getStake(delegator2)
            const d3StartStake = await getStake(delegator3)

            const currentRound = await roundsManager.currentRound()
            await bondingManager.claimEarnings(currentRound, {from: addr})

            const t1Stake = await getStake(transcoder1)
            const d1Stake = await getStake(delegator1)
            const d2Stake = await getStake(delegator2)
            const d3Stake = await getStake(delegator3)

            assert.isAtMost(t1Stake.sub(t1StartStake).abs().toNumber(), acceptableDelta)
            assert.isAtMost(d1Stake.sub(d1StartStake).abs().toNumber(), acceptableDelta)
            assert.isAtMost(d2Stake.sub(d2StartStake).abs().toNumber(), acceptableDelta)
            assert.isAtMost(d3Stake.sub(d3StartStake).abs().toNumber(), acceptableDelta)
        }

        await callRewardAndCheckStakes()

        await roundsManager.mineBlocks(roundLength)
        await roundsManager.initializeRound()

        await callRewardAndCheckStakes()

        // Check reward accounting after calling claimEarnings
        await claimEarningsAndCheckStakes(transcoder1)
        await claimEarningsAndCheckStakes(delegator1)
        await claimEarningsAndCheckStakes(delegator2)
        await claimEarningsAndCheckStakes(delegator3)

        await roundsManager.mineBlocks(roundLength)
        await roundsManager.initializeRound()

        await callRewardAndCheckStakes()

        // Check reward accounting after calling claimEarnings
        // Order should not matter - transcoder can claim in the middle
        await claimEarningsAndCheckStakes(delegator1)
        await claimEarningsAndCheckStakes(transcoder1)
        await claimEarningsAndCheckStakes(delegator2)
        await claimEarningsAndCheckStakes(delegator3)

        await roundsManager.mineBlocks(roundLength)
        await roundsManager.initializeRound()

        await callRewardAndCheckStakes()

        // Check reward accounting after calling claimEarnings
        // Order should not matter - transcoder can claim last
        await claimEarningsAndCheckStakes(delegator1)
        await claimEarningsAndCheckStakes(delegator2)
        await claimEarningsAndCheckStakes(delegator3)
        await claimEarningsAndCheckStakes(transcoder1)
    })
})
