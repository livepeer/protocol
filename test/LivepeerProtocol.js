var LivepeerProtocol = artifacts.require("LivepeerProtocol")

contract("LivepeerProtocol", accounts => {
    describe("constructor", () => {
        it("should create contract", async () => {
            const protocol = await LivepeerProtocol.new()

            assert.equal(await protocol.owner.call(), accounts[0], "did not set owner correctly")
        })
    })

    describe("after creation", () => {
        let protocol

        beforeEach(async () => {
            protocol = await LivepeerProtocol.new()
        })

        it("can set a registry contract", async () => {
            const randomAddress = "0x0000000000000000000000000000000000001234"
            const roundsManagerKey = await protocol.roundsManagerKey.call()

            await protocol.setRegistryContract(roundsManagerKey, randomAddress)

            assert.equal(await protocol.getRegistryContract(roundsManagerKey), randomAddress, "did not set registry contract address correctly")
        })
    })
})
