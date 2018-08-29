import {contractId} from "../../utils/helpers"
import BigNumber from "bignumber.js"

const Controller = artifacts.require("Controller")
const BondingManager = artifacts.require("BondingManager")
const AdjustableRoundsManager = artifacts.require("AdjustableRoundsManager")
const LivepeerToken = artifacts.require("LivepeerToken")

contract("System Pause", accounts => {
    const TOKEN_UNIT = 10 ** 18

    let controller
    let bondingManager
    let roundsManager
    let token

    let transcoder1
    let delegator1
    let delegator2

    let roundLength

    before(async () => {
        transcoder1 = accounts[0]
        delegator1 = accounts[2]
        delegator2 = accounts[3]

        controller = await Controller.deployed()
        await controller.unpause()

        const bondingManagerAddr = await controller.getContract(contractId("BondingManager"))
        bondingManager = await BondingManager.at(bondingManagerAddr)

        const roundsManagerAddr = await controller.getContract(contractId("RoundsManager"))
        roundsManager = await AdjustableRoundsManager.at(roundsManagerAddr)

        const tokenAddr = await controller.getContract(contractId("LivepeerToken"))
        token = await LivepeerToken.at(tokenAddr)

        const transferAmount = new BigNumber(10).times(TOKEN_UNIT)
        await token.transfer(transcoder1, transferAmount, {from: accounts[0]})
        await token.transfer(delegator1, transferAmount, {from: accounts[0]})
        await token.transfer(delegator2, transferAmount, {from: accounts[0]})

        roundLength = await roundsManager.roundLength.call()
        await roundsManager.mineBlocks(roundLength.toNumber() * 1000)
        await roundsManager.initializeRound()
    })

    it("registers transcoder 1 that self bonds", async () => {
        await token.approve(bondingManager.address, 1000, {from: transcoder1})
        await bondingManager.bond(1000, transcoder1, {from: transcoder1})
        await bondingManager.transcoder(0, 5, 100, {from: transcoder1})

        assert.equal(await bondingManager.transcoderStatus(transcoder1), 1, "wrong transcoder status")
    })

    it("delegator 1 bonds to transcoder 1", async () => {
        await token.approve(bondingManager.address, 1000, {from: delegator1})
        await bondingManager.bond(500, transcoder1, {from: delegator1})

        const bond = (await bondingManager.getDelegator(delegator1))[0]
        assert.equal(bond, 500, "delegator 1 bonded amount incorrect")
    })

    it("delegator 2 bonds to transcoder 1", async () => {
        await token.approve(bondingManager.address, 1000, {from: delegator2})
        await bondingManager.bond(500, transcoder1, {from: delegator2})

        const bond = (await bondingManager.getDelegator(delegator2))[0]
        assert.equal(bond, 500, "delegator 2 bonded amount incorrect")
    })

    it("transcoder calls reward, system is paused and resumed 5 rounds later", async () => {
        await roundsManager.mineBlocks(roundLength)
        await roundsManager.initializeRound()

        const pauseRound = await roundsManager.currentRound()
        await bondingManager.reward({from: transcoder1})
        const pauseRoundReward = (await bondingManager.getTranscoderEarningsPoolForRound(transcoder1, pauseRound))[0]

        await controller.pause()
        await roundsManager.mineBlocks(roundLength * 5)
        await controller.unpause()
        await roundsManager.initializeRound()

        const currentRound = await roundsManager.currentRound()
        const t1RewardShare = pauseRoundReward.div(2).floor()
        const d1RewardShare = pauseRoundReward.div(4).floor()
        const d2RewardShare = pauseRoundReward.div(4).floor()

        const startT1Info = await bondingManager.getDelegator(transcoder1)
        await bondingManager.claimEarnings(currentRound, {from: transcoder1})
        const endT1Info = await bondingManager.getDelegator(transcoder1)
        assert.equal(endT1Info[0].sub(startT1Info[0]), t1RewardShare.toNumber(), "wrong bonded amount for transcoder 1")

        const startD1Info = await bondingManager.getDelegator(delegator1)
        await bondingManager.claimEarnings(currentRound, {from: delegator1})
        const endD1Info = await bondingManager.getDelegator(delegator1)
        assert.equal(endD1Info[0].sub(startD1Info[0]), d1RewardShare.toNumber(), "wrong bonded amount for delegator 1")

        const startD2Info = await bondingManager.getDelegator(delegator2)
        await bondingManager.claimEarnings(currentRound, {from: delegator2})
        const endD2Info = await bondingManager.getDelegator(delegator2)
        assert.equal(endD2Info[0].sub(startD2Info[0]), d2RewardShare.toNumber(), "wrong bonded amount for delegator 2")
    })
})
