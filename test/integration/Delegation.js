import BigNumber from "bignumber.js"
import {contractId} from "../../utils/helpers"

const Controller = artifacts.require("Controller")
const BondingManager = artifacts.require("BondingManager")
const AdjustableRoundsManager = artifacts.require("AdjustableRoundsManager")
const LivepeerToken = artifacts.require("LivepeerToken")
const LivepeerTokenFaucet = artifacts.require("LivepeerTokenFaucet")

contract("Delegation", accounts => {
    let controller
    let bondingManager
    let roundsManager
    let token

    let transcoder1
    let transcoder2
    let delegator1
    let delegator2

    const TOKEN_UNIT = 10 ** 18

    before(async () => {
        transcoder1 = accounts[0]
        transcoder2 = accounts[1]
        delegator1 = accounts[2]
        delegator2 = accounts[3]

        controller = await Controller.deployed()

        const bondingManagerAddr = await controller.getContract(contractId("BondingManager"))
        bondingManager = await BondingManager.at(bondingManagerAddr)

        const roundsManagerAddr = await controller.getContract(contractId("RoundsManager"))
        roundsManager = await AdjustableRoundsManager.at(roundsManagerAddr)

        const tokenAddr = await controller.getContract(contractId("LivepeerToken"))
        token = await LivepeerToken.at(tokenAddr)

        const faucetAddr = await controller.getContract(contractId("LivepeerTokenFaucet"))
        const faucet = await LivepeerTokenFaucet.at(faucetAddr)

        await faucet.request({from: transcoder1})
        await faucet.request({from: transcoder2})
        await faucet.request({from: delegator1})
        await faucet.request({from: delegator2})

        const roundLength = await roundsManager.roundLength.call()
        await roundsManager.mineBlocks(roundLength.toNumber() * 1000)
        await roundsManager.initializeRound()
    })

    it("registers transcoder 1 that self bonds", async () => {
        const amount = new BigNumber(10).mul(TOKEN_UNIT)
        await token.approve(bondingManager.address, amount, {from: transcoder1})
        await bondingManager.bond(amount, transcoder1, {from: transcoder1})
        await bondingManager.transcoder(10, 5, 100, {from: transcoder1})

        assert.equal(await bondingManager.transcoderStatus(transcoder1), 1, "transcoder 1 status is incorrect")
    })

    it("registers transcoder 2 that self bonds", async () => {
        const amount = new BigNumber(10).mul(TOKEN_UNIT)
        await token.approve(bondingManager.address, amount, {from: transcoder2})
        await bondingManager.bond(amount, transcoder2, {from: transcoder2})
        await bondingManager.transcoder(10, 5, 100, {from: transcoder2})

        assert.equal(await bondingManager.transcoderStatus(transcoder2), 1, "transcoder 2 status is incorrect")
    })

    it("delegator 1 bonds to transcoder 1", async () => {
        const amount = new BigNumber(10).mul(TOKEN_UNIT)
        await token.approve(bondingManager.address, amount, {from: delegator1})
        await bondingManager.bond(amount, transcoder1, {from: delegator1})

        const bond = (await bondingManager.getDelegator(delegator1))[0]
        assert.equal(bond, amount.toNumber(), "delegator 1 bonded amount incorrect")
    })

    it("delegator 2 bonds to transcoder 1", async () => {
        const amount = new BigNumber(10).mul(TOKEN_UNIT)
        await token.approve(bondingManager.address, amount, {from: delegator2})
        await bondingManager.bond(amount, transcoder1, {from: delegator2})

        const bond = (await bondingManager.getDelegator(delegator2))[0]
        assert.equal(bond, amount.toNumber(), "delegator 2 bonded amount incorrect")
    })

    it("delegator 1 delegates to transcoder 2", async () => {
        await bondingManager.bond(0, transcoder2, {from: delegator1})

        const bond = (await bondingManager.getDelegator(delegator1))[2]
        assert.equal(bond, transcoder2, "delegator 1 delegate incorrect")
    })

    it("delegator 2 delegates to transcoder 2", async () => {
        await bondingManager.bond(0, transcoder2, {from: delegator2})

        const delegate = (await bondingManager.getDelegator(delegator2))[2]
        assert.equal(delegate, transcoder2, "delegator 2 delegate incorrect")
    })

    it("delegator 1 delegates more to transcoder 2", async () => {
        const startBond = (await bondingManager.getDelegator(delegator1))[0]

        const amount = new BigNumber(1).mul(TOKEN_UNIT)
        await token.approve(bondingManager.address, amount, {from: delegator1})
        await bondingManager.bond(amount, transcoder2, {from: delegator1})

        const endBond = (await bondingManager.getDelegator(delegator1))[0]
        assert.equal(endBond.sub(startBond), amount.toNumber(), "delegator 1 bonded amount did not increase correctly")
    })
})
