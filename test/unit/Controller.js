import Fixture from "./helpers/Fixture"
import {contractId} from "../../utils/helpers"
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

    describe("setContractInfo", () => {
        it("should throw when caller is not the owner", async () => {
            const randomAddress = "0x0000000000000000000000000000000000001234"
            const commitHash = "0x1230000000000000000000000000000000000000"
            await expectThrow(controller.setContractInfo(contractId("Manager"), randomAddress, commitHash, {from: accounts[1]}))
        })

        it("should set contract info", async () => {
            const id = contractId("Manager")
            const manager = await Manager.new(controller.address)
            const commitHash = "0x1230000000000000000000000000000000000000"
            await controller.setContractInfo(id, manager.address, commitHash)

            const cInfo = await controller.getContractInfo(id)
            assert.equal(cInfo[0], manager.address, "did not register contract address correctly")
            assert.equal(cInfo[1], commitHash, "did not register commit hash correctly")
        })
    })

    describe("updateController", () => {
        let id
        let manager

        beforeEach(async () => {
            id = contractId("Manager")
            manager = await Manager.new(controller.address)
            const commitHash = "0x1230000000000000000000000000000000000000"
            await controller.setContractInfo(id, manager.address, commitHash)
        })

        it("should throw when caller is not the owner", async () => {
            const randomAddress = "0x0000000000000000000000000000000000001234"
            await expectThrow(controller.updateController(id, randomAddress, {from: accounts[1]}))
        })

        it("should throw for invalid key", async () => {
            const randomAddress = "0x0000000000000000000000000000000000001234"
            const invalidId = "0x123"
            await expectThrow(controller.updateController(invalidId, randomAddress))
        })

        it("should update a manager's controller", async () => {
            const randomAddress = "0x0000000000000000000000000000000000001234"
            await controller.updateController(id, randomAddress)

            const newController = await manager.controller.call()
            assert.equal(newController, randomAddress, "controller for manager incorrect")
        })
    })
})
