import BN from "bn.js"
import Fixture from "./helpers/Fixture"
import expectThrow from "../helpers/expectThrow"
import truffleAssert from "truffle-assertions"
import calcTxCost from "../helpers/calcTxCost"
import {createWinningTicket, getTicketHash} from "../helpers/ticket"
import {functionSig} from "../../utils/helpers"

const TicketBroker = artifacts.require("LivepeerETHTicketBroker")

contract("LivepeerETHTicketBroker", accounts => {
    let fixture
    let broker

    const sender = accounts[0]
    const recipient = accounts[1]

    before(async () => {
        fixture = new Fixture(web3)
        await fixture.deploy()
    })

    beforeEach(async () => {
        await fixture.setUp()
        broker = await TicketBroker.new(fixture.controller.address, 0, 0)
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

        it("reduces the sender's ETH balance", async () => {
            const startBalance = new BN(await web3.eth.getBalance(sender))

            const txResult = await broker.fundDeposit({from: sender, value: 1000})

            const endBalance = new BN(await web3.eth.getBalance(sender))
            const txCost = await calcTxCost(txResult)

            assert.equal(startBalance.sub(endBalance).sub(txCost).toString(), "1000")
        })

        it("tracks the sender's ETH deposit amount", async () => {
            await broker.fundDeposit({from: sender, value: 1000})

            const deposit = (await broker.senders.call(sender)).deposit.toString()

            assert.equal(deposit, "1000")
        })

        it("tracks sender's multiple deposits", async () => {
            await broker.fundDeposit({from: sender, value: 1000})
            await broker.fundDeposit({from: sender, value: 500})

            const deposit = (await broker.senders.call(sender)).deposit.toString()

            assert.equal(deposit, "1500")
        })

        it("track multiple sender's deposits", async () => {
            const sender2 = accounts[2]
            await broker.fundDeposit({from: sender, value: 1000})
            await broker.fundDeposit({from: sender2, value: 500})

            const deposit = (await broker.senders.call(sender)).deposit.toString()
            const deposit2 = (await broker.senders.call(sender2)).deposit.toString()

            assert.equal(deposit, "1000")
            assert.equal(deposit2, "500")
        })

        it("emits a DepositFunded event", async () => {
            const txResult = await broker.fundDeposit({from: sender, value: 1000})

            truffleAssert.eventEmitted(txResult, "DepositFunded", ev => {
                return ev.sender === sender && ev.amount.toString() === "1000"
            })
        })

        it("emits a DepositFunded event with indexed sender", async () => {
            const sender2 = accounts[2]
            const fromBlock = (await web3.eth.getBlock("latest")).number
            await broker.fundDeposit({from: sender, value: 1000})
            await broker.fundDeposit({from: sender2, value: 1000})

            const events = await broker.getPastEvents("DepositFunded", {
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

    describe("fundPenaltyEscrow", () => {
        it("reverts when penalty escrow < minPenaltyEscrow", async () => {
            broker = await TicketBroker.new(fixture.controller.address, 1000, 0)

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

    describe("redeemWinningTicket", () => {
        describe("winningTicketTransfer", () => {
            it("updates transcoder with fees on bonding manager with deposit when deposit < faceValue", async () => {
                const currentRound = 17
                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
                const fromBlock = (await web3.eth.getBlock("latest")).number
                const deposit = 500
                await broker.fundDeposit({from: sender, value: deposit})

                const recipientRand = 5
                const faceValue = 1000
                const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

                await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                const events = await fixture.bondingManager.getPastEvents("UpdateTranscoderWithFees", {
                    fromBlock,
                    toBlock: "latest"
                })

                assert.equal(events.length, 1)
                const event = events[0]
                assert.equal(event.returnValues.transcoder, recipient)
                assert.equal(event.returnValues.fees, deposit.toString())
                assert.equal(event.returnValues.round, currentRound)
            })

            it("updates transcoder fees on bonding manager with faceValue when deposit > faceValue", async () => {
                const currentRound = 17
                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
                const fromBlock = (await web3.eth.getBlock("latest")).number
                const deposit = 1500
                await broker.fundDeposit({from: sender, value: deposit})

                const recipientRand = 5
                const faceValue = 1000
                const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

                await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                const events = await fixture.bondingManager.getPastEvents("UpdateTranscoderWithFees", {
                    fromBlock,
                    toBlock: "latest"
                })

                assert.equal(events.length, 1)
                const event = events[0]
                assert.equal(event.returnValues.transcoder, recipient)
                assert.equal(event.returnValues.fees, faceValue.toString())
                assert.equal(event.returnValues.round, currentRound)
            })

            it("updates transcoder fees on bonding manager with faceValue when deposit == faceValue", async () => {
                const currentRound = 17
                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
                const fromBlock = (await web3.eth.getBlock("latest")).number
                const deposit = 1500
                await broker.fundDeposit({from: sender, value: deposit})

                const recipientRand = 5
                const faceValue = 1500
                const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

                await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                const events = await fixture.bondingManager.getPastEvents("UpdateTranscoderWithFees", {
                    fromBlock,
                    toBlock: "latest"
                })

                assert.equal(events.length, 1)
                const event = events[0]
                assert.equal(event.returnValues.transcoder, recipient)
                assert.equal(event.returnValues.fees, faceValue.toString())
                assert.equal(event.returnValues.round, currentRound)
            })
        })

        describe("penaltyEscrowSlash", () => {
            it("burns sender.penaltyEscrow and sets penaltyEscrow to zero when deposit < faceValue", async () => {
                const fromBlock = (await web3.eth.getBlock("latest")).number
                const penaltyEscrow = 2000
                await broker.fundPenaltyEscrow({from: sender, value: penaltyEscrow})

                const recipientRand = 5
                const faceValue = 1000
                const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

                await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})


                const events = await fixture.minter.getPastEvents("TrustedBurnETH", {
                    fromBlock,
                    toBlock: "latest"
                })
                const endPenaltyEscrow = (await broker.senders.call(sender)).penaltyEscrow.toString()

                assert.equal(events.length, 1)
                const event = events[0]
                assert.equal(event.returnValues.amount, penaltyEscrow.toString())
                assert.equal(endPenaltyEscrow, 0)
            })

            it("does not burn sender.penaltyEscrow when deposit < faceValue and penaltyEscrow == 0", async () => {
                const fromBlock = (await web3.eth.getBlock("latest")).number
                const deposit = 500
                await broker.fundDeposit({from: sender, value: deposit})

                const recipientRand = 5
                const faceValue = 1000
                const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

                await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                const events = await fixture.minter.getPastEvents("TrustedBurnETH", {
                    fromBlock,
                    toBlock: "latest"
                })

                assert.equal(events.length, 0)
            })
        })
    })
})