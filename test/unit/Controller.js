import Fixture from "../helpers/fixture"
import ethUtil from "ethereumjs-util"
import ethAbi from "ethereumjs-abi"
import expectThrow from "../helpers/expectThrow"

const Manager = artifacts.require("Manager")
const Controller = artifacts.require("Controller")

contract("Controller", accounts => {
    describe("constructor", () => {
        it("should create contract", async () => {
            const controller = await Controller.new()

            assert.equal(await controller.owner.call(), accounts[0], "did not set owner correctly")
        })
    })

    let fixture
    let controller

    before(async () => {
        fixture = new Fixture(web3)
        controller = await Controller.new()
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("setContract", () => {
        it("should throw when caller is not the owner", async () => {
            const randomAddress = "0x0000000000000000000000000000000000001234"
            await expectThrow(controller.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["Manager"])), randomAddress, {from: accounts[1]}))
        })

        it("should set a registry contract", async () => {
            const contractId = ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["Manager"]))
            const manager = await Manager.new(controller.address)
            await controller.setContract(contractId, manager.address)

            const contractAddr = await controller.getContract(contractId)
            assert.equal(contractAddr, manager.address, "did not register contract address correctly")
        })
    })

    describe("updateController", () => {
        let contractId
        let manager

        beforeEach(async () => {
            contractId = ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["Manager"]))
            manager = await Manager.new(controller.address)
            await controller.setContract(contractId, manager.address)
        })

        it("should throw when caller is not the owner", async () => {
            const randomAddress = "0x0000000000000000000000000000000000001234"
            await expectThrow(controller.updateController(contractId, randomAddress, {from: accounts[1]}))
        })

        it("should throw for invalid key", async () => {
            const randomAddress = "0x0000000000000000000000000000000000001234"
            const invalidId = "0x123"
            await expectThrow(controller.updateController(invalidId, randomAddress))
        })

        it("should update a manager's controller", async () => {
            const randomAddress = "0x0000000000000000000000000000000000001234"
            await controller.updateController(contractId, randomAddress)

            const newController = await manager.controller.call()
            assert.equal(newController, randomAddress, "controller for manager incorrect")
        })
    })
})
