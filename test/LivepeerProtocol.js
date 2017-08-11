import ethUtil from "ethereumjs-util"
import ethAbi from "ethereumjs-abi"
import expectThrow from "./helpers/expectThrow"

const LivepeerProtocol = artifacts.require("LivepeerProtocol")
const Manager = artifacts.require("Manager")

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
            const manager = await Manager.new(protocol.address)

            await protocol.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["Manager"])), manager.address)

            assert.equal(await protocol.registry.call(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["Manager"]))), manager.address, "did not set registry contract address correctly")
        })
    })

    describe("updateRegistryManager", () => {
        let manager

        before(async () => {
            await setup()
            manager = await Manager.new(protocol.address)
            await protocol.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["Manager"])), manager.address)
            await protocol.unpause()
        })

        it("should throw when manager is not paused", async () => {
            const randomAddress = "0x0000000000000000000000000000000000001234"
            await expectThrow(protocol.updateManagerRegistry(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["Manager"])), randomAddress))
        })

        it("should throw for invalid key", async () => {
            const randomAddress = "0x0000000000000000000000000000000000001234"
            const invalidKey = "0x123"
            await expectThrow(protocol.updateManagerRegistry(invalidKey, randomAddress))
        })

        it("should update a manager's registry", async () => {
            await protocol.pause()

            const randomAddress = "0x0000000000000000000000000000000000001234"
            await protocol.updateManagerRegistry(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["Manager"])), randomAddress)

            const registry = await manager.registry.call()
            assert.equal(registry, randomAddress, "registry for manager incorrect")
        })
    })
})
