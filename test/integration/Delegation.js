import {contractId} from "../../utils/helpers"
import expectThrow from "../helpers/expectThrow"

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

    let roundLength

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

        roundLength = await roundsManager.roundLength.call()
        await roundsManager.mineBlocks(roundLength.toNumber() * 1000)
        await roundsManager.initializeRound()
    })

    it("registers transcoder 1 that self bonds", async () => {
        await token.approve(bondingManager.address, 1000, {from: transcoder1})
        await bondingManager.bond(1000, transcoder1, {from: transcoder1})
        await bondingManager.transcoder(10, 5, 100, {from: transcoder1})

        assert.equal(await bondingManager.transcoderStatus(transcoder1), 1, "wrong transcoder status")
    })

    it("registers transcoder 2 that self bonds", async () => {
        await token.approve(bondingManager.address, 1000, {from: transcoder2})
        await bondingManager.bond(1000, transcoder2, {from: transcoder2})
        await bondingManager.transcoder(10, 5, 100, {from: transcoder2})

        assert.equal(await bondingManager.transcoderStatus(transcoder2), 1, "wrong transcoder status")
    })

    it("delegator 1 bonds to transcoder 1", async () => {
        await token.approve(bondingManager.address, 1000, {from: delegator1})
        await bondingManager.bond(1000, transcoder1, {from: delegator1})

        const bond = (await bondingManager.getDelegator(delegator1))[0]
        assert.equal(bond, 1000, "delegator 1 bonded amount incorrect")
    })

    it("delegator 2 bonds to transcoder 1", async () => {
        await token.approve(bondingManager.address, 1000, {from: delegator2})
        await bondingManager.bond(1000, transcoder1, {from: delegator2})

        const bond = (await bondingManager.getDelegator(delegator2))[0]
        assert.equal(bond, 1000, "delegator 2 bonded amount incorrect")
    })

    it("delegator 1 delegates to transcoder 2", async () => {
        await bondingManager.bond(0, transcoder2, {from: delegator1})

        const delegate = (await bondingManager.getDelegator(delegator1))[2]
        assert.equal(delegate, transcoder2, "delegator 1 delegate incorrect")
        const delegatedStake = (await bondingManager.getDelegator(transcoder2))[3]
        assert.equal(delegatedStake, 2000, "wrong delegated stake")
    })

    it("delegator 2 delegates to transcoder 2", async () => {
        await bondingManager.bond(0, transcoder2, {from: delegator2})

        const delegate = (await bondingManager.getDelegator(delegator2))[2]
        assert.equal(delegate, transcoder2, "delegator 2 delegate incorrect")
        const delegatedStake = (await bondingManager.getDelegator(transcoder2))[3]
        assert.equal(delegatedStake, 3000, "wrong delegated stake")
    })

    it("delegator 1 delegates more to transcoder 2", async () => {
        const startBond = (await bondingManager.getDelegator(delegator1))[0]

        await token.approve(bondingManager.address, 1000, {from: delegator1})
        await bondingManager.bond(1000, transcoder2, {from: delegator1})

        const endBond = (await bondingManager.getDelegator(delegator1))[0]
        assert.equal(endBond.sub(startBond), 1000, "delegator 1 bonded amount did not increase correctly")
    })

    it("delegator 2 unbonds from transcoder 2", async () => {
        await roundsManager.mineBlocks(roundLength)
        await roundsManager.initializeRound()
        await bondingManager.unbond({from: delegator2})

        // Cannot bond again
        await expectThrow(bondingManager.bond(0, transcoder2, {from: delegator2}))
    })

    it("delegator 2 does not withdraw its stake and bonds again far in the future", async () => {
        await roundsManager.mineBlocks(roundLength.toNumber() * 1000)
        await roundsManager.initializeRound()

        // Delegates its bonded stake which has yet to be withdrawn to transcoder 2
        // Should not have to claim rewards and fees for any rounds and should instead just skip to the current round
        await bondingManager.bond(0, transcoder2, {from: delegator2})

        const dInfo = await bondingManager.getDelegator(delegator2)
        const currentRound = await roundsManager.currentRound()
        assert.equal(dInfo[2], transcoder2, "wrong delegate")
        assert.equal(dInfo[6], currentRound.toNumber(), "wrong last claim round")
    })
})
