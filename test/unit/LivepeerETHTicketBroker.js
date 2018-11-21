import Fixture from "./helpers/Fixture"

const TicketBroker = artifacts.require("LivepeerETHTicketBroker")

contract("LivepeerETHTicketBroker", accounts => {
    let fixture
    let broker

    const sender = accounts[0]

    before(async () => {
        fixture = new Fixture(web3)
        await fixture.deploy()

        broker = await TicketBroker.new(fixture.controller.address, 0)
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("fundDeposit", () => {
        it("grows the Minter ETH balance", async () => {
            await broker.fundDeposit({from: sender, value: 1000})

            const balance = await web3.eth.getBalance(fixture.minter.address)

            assert.equal(balance, "1000")
        })
    })

    describe("fundPenaltyEscrow", () => {
        it("grows the Minter ETH balance", async () => {
            await broker.fundPenaltyEscrow({from: sender, value: 1000})

            const balance = await web3.eth.getBalance(fixture.minter.address)

            assert.equal(balance, "1000")
        })
    })
})