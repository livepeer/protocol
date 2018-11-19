import BN from "bn.js"
import truffleAssert from "truffle-assertions"
import calcTxCost from "../helpers/calcTxCost"
import expectThrow from "../helpers/expectThrow"

const TicketBroker = artifacts.require("TicketBroker")

contract("TicketBroker", accounts => {
    let broker

    beforeEach(async () => {
        broker = await TicketBroker.new(0)
    })

    describe("fundDeposit", () => {
        it("grows the broker ETH balance", async () => {
            await broker.fundDeposit({from: accounts[0], value: 1000})

            const balance = await web3.eth.getBalance(broker.address)

            assert.equal(balance, "1000")
        })

        it("reduces the sender's ETH balance", async () => {
            const startBalance = new BN(await web3.eth.getBalance(accounts[0]))

            const txRes = await broker.fundDeposit({from: accounts[0], value: 1000})

            const endBalance = new BN(await web3.eth.getBalance(accounts[0]))
            const txCost = await calcTxCost(txRes)

            assert.equal(startBalance.sub(endBalance).sub(txCost).toString(), "1000")
        })

        it("tracks the sender's ETH deposit amount", async () => {
            await broker.fundDeposit({from: accounts[0], value: 1000})

            const deposit = (await broker.senders.call(accounts[0])).deposit.toString()

            assert.equal(deposit, "1000")
        })

        it("tracks sender's multiple deposits", async () => {
            await broker.fundDeposit({from: accounts[0], value: 1000})
            await broker.fundDeposit({from: accounts[0], value: 500})

            const deposit = (await broker.senders.call(accounts[0])).deposit.toString()

            assert.equal(deposit, "1500")
        })

        it("track multiple sender's deposits", async () => {
            await broker.fundDeposit({from: accounts[0], value: 1000})
            await broker.fundDeposit({from: accounts[1], value: 500})

            const deposit0 = (await broker.senders.call(accounts[0])).deposit.toString()
            const deposit1 = (await broker.senders.call(accounts[1])).deposit.toString()

            assert.equal(deposit0, "1000")
            assert.equal(deposit1, "500")
        })

        it("emits a DepositFunded event", async () => {
            const txResult = await broker.fundDeposit({from: accounts[0], value: 1000})

            truffleAssert.eventEmitted(txResult, "DepositFunded", ev => {
                return ev.sender === accounts[0] && ev.amount.toString() === "1000"
            })
        })

        it("emits a DepositFunded event with indexed sender", async () => {
            await broker.fundDeposit({from: accounts[0], value: 1000})
            await broker.fundDeposit({from: accounts[1], value: 1000})

            const events = await broker.getPastEvents("DepositFunded", {
                filter: {
                    sender: accounts[0]
                },
                fromBlock: 0,
                toBlock: "latest"
            })

            assert.equal(events.length, 1)
            assert.equal(events[0].returnValues.sender, accounts[0])
            assert.equal(events[0].returnValues.amount.toString(), "1000")
        })
    })

    describe("fundPenaltyEscrow", () => {
        it("reverts if ETH sent < required penalty escrow", async () => {
            broker = await TicketBroker.new(web3.utils.toWei(".5", "ether"))

            await expectThrow(broker.fundPenaltyEscrow({from: accounts[0], value: web3.utils.toWei(".49", "ether")}))
        })

        it("grows the broker's ETH balance", async () => {
            await broker.fundPenaltyEscrow({from: accounts[0], value: 1000})

            const balance = await web3.eth.getBalance(broker.address)

            assert.equal(balance, "1000")
        })

        it("reduces the sender's ETH balance", async () => {
            const startBalance = new BN(await web3.eth.getBalance(accounts[0]))

            const txRes = await broker.fundPenaltyEscrow({from: accounts[0], value: 1000})

            const endBalance = new BN(await web3.eth.getBalance(accounts[0]))
            const txCost = await calcTxCost(txRes)

            assert.equal(startBalance.sub(endBalance).sub(txCost).toString(), "1000")
        })

        it("tracks the sender's ETH penalty escrow", async () => {
            await broker.fundPenaltyEscrow({from: accounts[0], value: 1000})

            const penaltyEscrow = (await broker.senders.call(accounts[0])).penaltyEscrow.toString()

            assert.equal(penaltyEscrow, "1000")
        })

        it("tracks sender's multiple penalty escrow fundings", async () => {
            await broker.fundPenaltyEscrow({from: accounts[0], value: 1000})
            await broker.fundPenaltyEscrow({from: accounts[0], value: 500})

            const penaltyEscrow = (await broker.senders.call(accounts[0])).penaltyEscrow.toString()

            assert.equal(penaltyEscrow, "1500")
        })

        it("track multiple sender's penalty escrows", async () => {
            await broker.fundPenaltyEscrow({from: accounts[0], value: 1000})
            await broker.fundPenaltyEscrow({from: accounts[1], value: 500})

            const penaltyEscrow0 = (await broker.senders.call(accounts[0])).penaltyEscrow.toString()
            const penaltyEscrow1 = (await broker.senders.call(accounts[1])).penaltyEscrow.toString()

            assert.equal(penaltyEscrow0, "1000")
            assert.equal(penaltyEscrow1, "500")
        })

        it("emits a PenaltyEscrowFunded event", async () => {
            const txResult = await broker.fundPenaltyEscrow({from: accounts[0], value: 1000})

            truffleAssert.eventEmitted(txResult, "PenaltyEscrowFunded", ev => {
                return ev.sender === accounts[0] && ev.amount.toString() === "1000"
            })
        })

        it("emits a PenaltyEscrowFunded event with indexed sender", async () => {
            await broker.fundPenaltyEscrow({from: accounts[0], value: 1000})
            await broker.fundPenaltyEscrow({from: accounts[1], value: 1000})

            const events = await broker.getPastEvents("PenaltyEscrowFunded", {
                filter: {
                    sender: accounts[0]
                },
                fromBlock: 0,
                toBlock: "latest"
            })

            assert.equal(events.length, 1)
            assert.equal(events[0].returnValues.sender, accounts[0])
            assert.equal(events[0].returnValues.amount.toString(), "1000")
        })
    })
})
