import BN from "bn.js"
import Fixture from "./helpers/Fixture"
import expectThrow from "../helpers/expectThrow"
import truffleAssert from "truffle-assertions"
import calcTxCost from "../helpers/calcTxCost"

const TicketBroker = artifacts.require("LivepeerETHTicketBroker")

contract("LivepeerETHTicketBroker", accounts => {
    let fixture
    let broker

    const sender = accounts[0]

    before(async () => {
        fixture = new Fixture(web3)
        await fixture.deploy()
    })

    beforeEach(async () => {
        await fixture.setUp()
        broker = await TicketBroker.new(fixture.controller.address, 0)
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
        it("reverts when penalty escrow < minPenaltyEscrow", async () => {
            broker = await TicketBroker.new(fixture.controller.address, 1000)

            await expectThrow(broker.fundPenaltyEscrow({from: sender, value: 500}))
        })

        it("tracks sender's ETH penalty escrow", async () => {
            await broker.fundPenaltyEscrow({from: sender, value: 1000})

            const penaltyEscrow = (await broker.senders.call(sender)).penaltyEscrow.toString()

            assert.equal(penaltyEscrow, "1000")
        })

        it("tracks sender's multiple ETH penalty escrow fundings", async () => {
            await broker.fundPenaltyEscrow({from: sender, value: 1000})
            await broker.fundPenaltyEscrow({from: sender, value: 500})

            const penaltyEscrow = (await broker.senders.call(sender)).penaltyEscrow.toString()

            assert.equal(penaltyEscrow, "1500")
        })

        it("grows the Minter ETH balance", async () => {
            await broker.fundPenaltyEscrow({from: sender, value: 1000})

            const balance = await web3.eth.getBalance(fixture.minter.address)

            assert.equal(balance, "1000")
        })

        it("reduces the sender's ETH balance", async () => {
            const startBalance = new BN(await web3.eth.getBalance(sender))

            const txRes = await broker.fundPenaltyEscrow({from: sender, value: 1000})

            const endBalance = new BN(await web3.eth.getBalance(sender))
            const txCost = await calcTxCost(txRes)

            assert.equal(startBalance.sub(endBalance).sub(txCost).toString(), "1000")
        })

        it("emits a PenaltyEscrowFunded event", async () => {
            const txResult = await broker.fundPenaltyEscrow({from: sender, value: 1000})

            truffleAssert.eventEmitted(txResult, "PenaltyEscrowFunded", ev => {
                return ev.sender === sender && ev.amount.toString() === "1000"
            })
        })

        it("emits a PenaltyEscrowFunded event with indexed sender", async () => {
            const sender2 = accounts[2]
            const fromBlock = (await web3.eth.getBlock("latest")).number
            await broker.fundPenaltyEscrow({from: sender, value: 1000})
            await broker.fundPenaltyEscrow({from: sender2, value: 1000})

            const events = await broker.getPastEvents("PenaltyEscrowFunded", {
                filter: {
                    sender
                },
                fromBlock,
                toBlock: "latest"
            })

            assert.equal(events.length, 1)
            assert.equal(events[0].returnValues.sender, sender)
            assert.equal(events[0].returnValues.amount.toString(), "1000")
        })
    })
})
