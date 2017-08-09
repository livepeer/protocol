import ethUtil from "ethereumjs-util"
import ethAbi from "ethereumjs-abi"
import expectThrow from "./helpers/expectThrow"

const LivepeerProtocol = artifacts.require("LivepeerProtocol")
const Controller = artifacts.require("Controller")

contract("LivepeerProtocol", accounts => {
    describe("constructor", () => {
        it("should create contract", async () => {
            const protocol = await LivepeerProtocol.new()

            assert.equal(await protocol.owner.call(), accounts[0], "did not set owner correctly")
        })
    })

    let protocol

    const setup = async () => {
        protocol = await LivepeerProtocol.new()
    }

    describe("setContract", () => {
        before(async () => {
            await setup()
        })

        it("should set a registry contract", async () => {
            const controller = await Controller.new(protocol.address)

            await protocol.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["Controller"])), controller.address)

            assert.equal(
                await protocol.registry.call(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["Controller"]))),
                controller.address,
                "did not set registry contract address correctly"
            )
        })
    })

    describe("updateControllerManager", () => {
        let controller

        before(async () => {
            await setup()
            controller = await Controller.new(protocol.address)
            await protocol.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["Controller"])), controller.address)
        })

        it("should throw when manager is not paused", async () => {
            const randomAddress = "0x0000000000000000000000000000000000001234"
            await expectThrow(protocol.updateControllerManager(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["Controller"])), randomAddress))
        })

        it("should throw for invalid key", async () => {
            const randomAddress = "0x0000000000000000000000000000000000001234"
            const invalidKey = "0x123"
            await expectThrow(protocol.updateControllerManager(invalidKey, randomAddress))
        })

        it("should update a controller's manager", async () => {
            await protocol.pause()
            await controller.pause()

            const randomAddress = "0x0000000000000000000000000000000000001234"
            await protocol.updateControllerManager(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["Controller"])), randomAddress)

            const manager = await controller.manager.call()
            assert.equal(manager, randomAddress, "manager for controller incorrect")
        })
    })
})
