import expectThrow from "./helpers/expectThrow"

const LivepeerProtocol = artifacts.require("LivepeerProtocol")
const RoundsManager = artifacts.require("RoundsManager")

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

    describe("setRegistryContract", () => {
        before(async () => {
            await setup()
        })

        it("should set a registry contract", async () => {
            const roundsManager = await RoundsManager.new()
            const roundsManagerKey = await protocol.roundsManagerKey.call()

            await protocol.setRegistryContract(roundsManagerKey, roundsManager.address)

            assert.equal(await protocol.getRegistryContract(roundsManagerKey), roundsManager.address, "did not set registry contract address correctly")
        })
    })

    describe("updateController", () => {
        let roundsManager
        let roundsManagerKey

        before(async () => {
            await setup()

            roundsManager = await RoundsManager.new()
            roundsManagerKey = await protocol.roundsManagerKey.call()

            await protocol.setRegistryContract(roundsManagerKey, roundsManager.address)
            await roundsManager.initialize(protocol.address)
        })

        it("should throw for invalid key", async () => {
            const randomAddress = "0x0000000000000000000000000000000000001234"
            const invalidKey = "0x123"

            await expectThrow(protocol.updateController(invalidKey, randomAddress))
        })

        it("should update a registry contract's controller", async () => {
            const randomAddress = "0x0000000000000000000000000000000000001234"

            await protocol.updateController(roundsManagerKey, randomAddress)

            const controller = await roundsManager.controller.call()
            assert.equal(controller, randomAddress, "controller for registry contract incorrect")
        })
    })
})
