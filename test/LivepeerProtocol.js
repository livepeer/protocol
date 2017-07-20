import RPC from "../utils/rpc"
import expectThrow from "./helpers/expectThrow"

var LivepeerProtocol = artifacts.require("LivepeerProtocol")
var RoundsManager = artifacts.require("RoundsManager")

contract("LivepeerProtocol", accounts => {
    describe("constructor", () => {
        it("should create contract", async () => {
            const protocol = await LivepeerProtocol.new()

            assert.equal(await protocol.owner.call(), accounts[0], "did not set owner correctly")
        })
    })

    let protocol
    let rpc
    let snapshotId

    const setup = async () => {
        rpc = new RPC(web3)
        snapshotId = await rpc.snapshot()
        protocol = await LivepeerProtocol.new()
    }

    const teardown = async () => {
        await rpc.revert(snapshotId)
    }

    describe("setRegistryContract", () => {
        beforeEach(async () => {
            await setup()
        })

        afterEach(async () => {
            await teardown()
        })

        it("should set a registry contract", async () => {
            const roundsManager = await RoundsManager.new()
            const roundsManagerKey = await protocol.roundsManagerKey.call()

            await protocol.setRegistryContract(roundsManagerKey, roundsManager.address)

            assert.equal(await protocol.getRegistryContract(roundsManagerKey), roundsManager.address, "did not set registry contract address correctly")
        })

        it("should throw if contract is not controllable", async () => {
            const randomKey = "0x123"

            await expectThrow(protocol.setRegistryContract(randomKey, accounts[3]))
        })
    })

    describe("updateController", () => {
        let roundsManager
        let roundsManagerKey

        beforeEach(async () => {
            await setup()

            roundsManager = await RoundsManager.new()
            roundsManagerKey = await protocol.roundsManagerKey.call()

            await protocol.setRegistryContract(roundsManagerKey, roundsManager.address)
            await roundsManager.initialize(protocol.address)
        })

        afterEach(async () => {
            await teardown()
        })

        it("should update a registry contract's controller", async () => {
            const randomAddress = "0x0000000000000000000000000000000000001234"

            await protocol.updateController(roundsManagerKey, randomAddress)

            const controller = await roundsManager.controller.call()
            assert.equal(controller, randomAddress, "controller for registry contract incorrect")
        })

        it("should throw for invalid key", async () => {
            const randomAddress = "0x0000000000000000000000000000000000001234"
            const invalidKey = "0x123"

            await expectThrow(protocol.updateController(invalidKey, randomAddress))
        })
    })
})
