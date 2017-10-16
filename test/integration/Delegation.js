import {contractId} from "../../utils/helpers"

const Controller = artifacts.require("Controller")
const BondingManager = artifacts.require("BondingManager")

contract("Delegation", accounts => {
    let controller
    let bondingManager

    before(async () => {
        controller = await Controller.deployed()
        const bondingManagerAddr = await controller.getContract(contractId("BondingManager"))
        bondingManager = await BondingManager.at(bondingManagerAddr)
    })

    it("registers transcoder 1", async () => {
         await bondingManager.transcoder(10, 5, 100, {from: accounts[0]})

        assert.equal(await bondingManager.transcoderStatus(accounts[0]), 1, "transcoder 1 status is incorrect")
    })

    it("registers transcoder 2", async () => {
        await bondingManager.transcoder(10, 5, 100, {from: accounts[1]})

        assert.equal(await bondingManager.transcoderStatus(accounts[1]), 1, "transcoder 2 status is incorrect")
    })
})
