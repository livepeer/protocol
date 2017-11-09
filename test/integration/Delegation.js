import BigNumber from "bignumber.js"
import {contractId} from "../../utils/helpers"

const Controller = artifacts.require("Controller")
const BondingManager = artifacts.require("BondingManager")
const LivepeerToken = artifacts.require("LivepeerToken")
const LivepeerTokenFaucet = artifacts.require("LivepeerTokenFaucet")

contract("Delegation", accounts => {
    let controller
    let bondingManager
    let token

    const TOKEN_UNIT = 10 ** 18

    before(async () => {
        controller = await Controller.deployed()
        const bondingManagerAddr = await controller.getContract(contractId("BondingManager"))
        bondingManager = await BondingManager.at(bondingManagerAddr)

        const tokenAddr = await controller.getContract(contractId("LivepeerToken"))
        token = await LivepeerToken.at(tokenAddr)

        const faucetAddr = await controller.getContract(contractId("LivepeerTokenFaucet"))
        const faucet = await LivepeerTokenFaucet.at(faucetAddr)

        await faucet.request({from: accounts[0]})
        await faucet.request({from: accounts[1]})
        await faucet.request({from: accounts[2]})
        await faucet.request({from: accounts[3]})
    })

    it("registers transcoder 1", async () => {
        await bondingManager.transcoder(10, 5, 100, {from: accounts[0]})

        assert.equal(await bondingManager.transcoderStatus(accounts[0]), 1, "transcoder 1 status is incorrect")
    })

    it("registers transcoder 2", async () => {
        await bondingManager.transcoder(10, 5, 100, {from: accounts[1]})

        assert.equal(await bondingManager.transcoderStatus(accounts[1]), 1, "transcoder 2 status is incorrect")
    })

    it("delegator 1 bonds to transcoder 1", async () => {
        const amount = new BigNumber(10).mul(TOKEN_UNIT)
        await token.approve(bondingManager.address, amount, {from: accounts[2]})
        await bondingManager.bond(amount, accounts[0], {from: accounts[2]})

        const delegator = await bondingManager.getDelegator(accounts[2])
        assert.equal(delegator[0], amount.toNumber(), "delegator 1 bonded amount incorrect")
    })

    it("delegator 2 bonds to transcoder 1", async () => {
        const amount = new BigNumber(10).mul(TOKEN_UNIT)
        await token.approve(bondingManager.address, amount, {from: accounts[3]})
        await bondingManager.bond(amount, accounts[0], {from: accounts[3]})

        const delegator = await bondingManager.getDelegator(accounts[3])
        assert.equal(delegator[0], amount.toNumber(), "delegator 2 bonded amount incorrect")
    })
})
