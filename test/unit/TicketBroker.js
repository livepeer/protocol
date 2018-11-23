import BN from "bn.js"
import truffleAssert from "truffle-assertions"
import calcTxCost from "../helpers/calcTxCost"
import expectThrow from "../helpers/expectThrow"
import {expectRevertWithReason} from "../helpers/expectFail"
import {createTicket, createWinningTicket, getTicketHash} from "../helpers/ticket"
import {constants} from "../../utils/constants"
import Fixture from "./helpers/Fixture"

const TicketBroker = artifacts.require("ETHTicketBroker")

contract("TicketBroker", accounts => {
    let broker
    let fixture

    const sender = accounts[0]
    const recipient = accounts[1]

    const unlockPeriod = 20

    before(async () => {
        fixture = new Fixture(web3)
    })

    beforeEach(async () => {
        broker = await TicketBroker.new(0, unlockPeriod)
    })

    describe("fundDeposit", () => {
        it("grows the broker ETH balance", async () => {
            await broker.fundDeposit({from: sender, value: 1000})

            const balance = await web3.eth.getBalance(broker.address)

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

        it("resets an unlock request in progress", async () => {
            await broker.fundDeposit({from: sender, value: 1000})
            await broker.unlock()

            await broker.fundDeposit({from: sender, value: 500})

            const isUnlockInProgress = await broker.isUnlockInProgress.call(sender)
            assert(!isUnlockInProgress)
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
        it("reverts if ETH sent < required penalty escrow", async () => {
            broker = await TicketBroker.new(web3.utils.toWei(".5", "ether"), 0)

            await expectThrow(broker.fundPenaltyEscrow({from: sender, value: web3.utils.toWei(".49", "ether")}))
        })

        it("grows the broker's ETH balance", async () => {
            await broker.fundPenaltyEscrow({from: sender, value: 1000})

            const balance = await web3.eth.getBalance(broker.address)

            assert.equal(balance, "1000")
        })

        it("reduces the sender's ETH balance", async () => {
            const startBalance = new BN(await web3.eth.getBalance(sender))

            const txRes = await broker.fundPenaltyEscrow({from: sender, value: 1000})

            const endBalance = new BN(await web3.eth.getBalance(sender))
            const txCost = await calcTxCost(txRes)

            assert.equal(startBalance.sub(endBalance).sub(txCost).toString(), "1000")
        })

        it("tracks the sender's ETH penalty escrow", async () => {
            await broker.fundPenaltyEscrow({from: sender, value: 1000})

            const penaltyEscrow = (await broker.senders.call(sender)).penaltyEscrow.toString()

            assert.equal(penaltyEscrow, "1000")
        })

        it("tracks sender's multiple penalty escrow fundings", async () => {
            await broker.fundPenaltyEscrow({from: sender, value: 1000})
            await broker.fundPenaltyEscrow({from: sender, value: 500})

            const penaltyEscrow = (await broker.senders.call(sender)).penaltyEscrow.toString()

            assert.equal(penaltyEscrow, "1500")
        })

        it("track multiple sender's penalty escrows", async () => {
            const sender2 = accounts[2]
            await broker.fundPenaltyEscrow({from: sender, value: 1000})
            await broker.fundPenaltyEscrow({from: sender2, value: 500})

            const penaltyEscrow = (await broker.senders.call(sender)).penaltyEscrow.toString()
            const penaltyEscrow2 = (await broker.senders.call(sender2)).penaltyEscrow.toString()

            assert.equal(penaltyEscrow, "1000")
            assert.equal(penaltyEscrow2, "500")
        })

        it("resets an unlock request in progress", async () => {
            await broker.fundPenaltyEscrow({from: sender, value: 1000})
            await broker.unlock()

            await broker.fundPenaltyEscrow({from: sender, value: 500})

            const isUnlockInProgress = await broker.isUnlockInProgress.call(sender)
            assert(!isUnlockInProgress)
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
        it("reverts if ticket's recipient is null address", async () => {
            await expectRevertWithReason(
                broker.redeemWinningTicket(
                    createTicket(),
                    web3.utils.asciiToHex("sig"),
                    5
                ),
                "ticket recipient is null address"
            )
        })

        it("reverts if ticket sender is null address", async () => {
            await expectRevertWithReason(
                broker.redeemWinningTicket(
                    createTicket({recipient}),
                    web3.utils.asciiToHex("sig"),
                    5
                ),
                "ticket sender is null address"
            )
        })

        it("reverts if ticket is expired", async () => {
            await expectRevertWithReason(
                broker.redeemWinningTicket(
                    createTicket({
                        recipient,
                        sender,
                        auxData: web3.utils.numberToHex(0)
                    }),
                    web3.utils.asciiToHex("sig"),
                    5
                ),
                "ticket is expired"
            )
        })

        it("reverts if recipientRand is not the preimage for the ticket's recipientRandHash", async () => {
            await expectRevertWithReason(
                broker.redeemWinningTicket(
                    createTicket({
                        recipient,
                        sender
                    }),
                    web3.utils.asciiToHex("sig"),
                    5
                ),
                "recipientRand does not match recipientRandHash"
            )
        })

        it("reverts if ticket is used", async () => {
            await broker.fundDeposit({from: sender, value: 1000})

            const recipientRand = 5
            const ticket = createWinningTicket(recipient, sender, recipientRand)
            const ticketHash = getTicketHash(ticket)
            const senderSig = await web3.eth.sign(ticketHash, sender)

            await broker.redeemWinningTicket(ticket, senderSig, recipientRand)

            assert.isOk(await broker.usedTickets.call(ticketHash))
            await expectRevertWithReason(
                broker.redeemWinningTicket(
                    ticket,
                    senderSig,
                    recipientRand
                ),
                "ticket is used"
            )
        })

        it("reverts if sender signature over ticket hash is invalid", async () => {
            const recipientRand = 5
            const recipientRandHash = web3.utils.soliditySha3(recipientRand)

            await expectRevertWithReason(
                broker.redeemWinningTicket(
                    createTicket({
                        recipient,
                        sender,
                        recipientRandHash
                    }),
                    web3.utils.asciiToHex("sig"),
                    recipientRand
                ),
                "invalid signature over ticket hash"
            )
        })

        it("reverts if the ticket did not win", async () => {
            const recipientRand = 5
            const recipientRandHash = web3.utils.soliditySha3(recipientRand)
            const ticket = createTicket({
                recipient,
                sender,
                recipientRandHash
            })
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

            await expectRevertWithReason(
                broker.redeemWinningTicket(
                    ticket,
                    senderSig,
                    recipientRand
                ),
                "ticket did not win"
            )
        })

        it("reverts if sender's deposit and penalty escrow are zero", async () => {
            const recipientRand = 5
            const ticket = createWinningTicket(recipient, sender, recipientRand)
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

            await expectRevertWithReason(
                broker.redeemWinningTicket(
                    ticket,
                    senderSig,
                    recipientRand
                ),
                "sender deposit and penalty escrow are zero"
            )
        })

        describe("deposit < faceValue", () => {
            describe("sender.deposit is zero", () => {
                it("does not transfer sender.deposit to recipient", async () => {
                    const penaltyEscrow = 2000
                    await broker.fundPenaltyEscrow({from: sender, value: penaltyEscrow})

                    const recipientRand = 5
                    const faceValue = 1000
                    const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                    const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)
                    const startRecipientBalance = new BN(await web3.eth.getBalance(recipient))

                    const txResult = await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                    const txCost = await calcTxCost(txResult)
                    const endRecipientBalance = new BN(await web3.eth.getBalance(recipient))

                    assert.equal(endRecipientBalance.sub(startRecipientBalance).add(txCost).toString(), "0")
                    truffleAssert.eventNotEmitted(txResult, "WinningTicketTransfer")
                })

                it("burns sender.penaltyEscrow", async () => {
                    const penaltyEscrow = 2000
                    await broker.fundPenaltyEscrow({from: sender, value: penaltyEscrow})

                    const recipientRand = 5
                    const faceValue = 1000
                    const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                    const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)
                    const startBrokerBalance = new BN(await web3.eth.getBalance(broker.address))
                    const startBurnedBalance = new BN(await web3.eth.getBalance(constants.NULL_ADDRESS))

                    const txRes = await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                    const txCost = await calcTxCost(txRes)
                    const blockReward = new BN(web3.utils.toWei("3", "ether"))
                    const burnAddressGanacheUpdates = txCost.add(blockReward)

                    const endBrokerBalance = new BN(await web3.eth.getBalance(broker.address))
                    const endBurnedBalance = new BN(await web3.eth.getBalance(constants.NULL_ADDRESS))
                    const endPenaltyEscrow = (await broker.senders.call(sender)).penaltyEscrow.toString()

                    assert.equal(startBrokerBalance.sub(endBrokerBalance).toString(), penaltyEscrow.toString())
                    assert.equal(endBurnedBalance.sub(startBurnedBalance).sub(burnAddressGanacheUpdates).toString(), penaltyEscrow.toString())
                    assert.equal(endPenaltyEscrow, "0")
                })
            })

            describe("sender.deposit is not zero", () => {
                it("transfers sender.deposit to recipient and sets sender.deposit to zero", async () => {
                    const deposit = 500
                    await broker.fundDeposit({from: sender, value: deposit})

                    const recipientRand = 5
                    const faceValue = 1000
                    const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                    const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)
                    const startBrokerBalance = new BN(await web3.eth.getBalance(broker.address))
                    const startRecipientBalance = new BN(await web3.eth.getBalance(recipient))

                    const txResult = await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                    const txCost = await calcTxCost(txResult)
                    const endBrokerBalance = new BN(await web3.eth.getBalance(broker.address))
                    const endRecipientBalance = new BN(await web3.eth.getBalance(recipient))
                    const endDeposit = (await broker.senders.call(sender)).deposit.toString()

                    assert.equal(startBrokerBalance.sub(endBrokerBalance).toString(), deposit.toString())
                    assert.equal(endRecipientBalance.sub(startRecipientBalance).add(txCost).toString(), deposit.toString())
                    assert.equal(endDeposit, "0")
                })

                it("emits a WinningTicketTransfer event", async () => {
                    const deposit = 500
                    await broker.fundDeposit({from: sender, value: deposit})

                    const recipientRand = 5
                    const faceValue = 1000
                    const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                    const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

                    const txResult = await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                    truffleAssert.eventEmitted(txResult, "WinningTicketTransfer", ev => {
                        return ev.sender === sender && ev.recipient === recipient && ev.amount.toString() === deposit.toString()
                    })
                })

                // TODO: tests for indexed arguments in WinningTicketTransfer

                describe("sender.penaltyEscrow is zero", () => {
                    it("does not burn sender.penaltyEscrow", async () => {
                        const deposit = 500
                        await broker.fundDeposit({from: sender, value: deposit})

                        const recipientRand = 5
                        const faceValue = 1000
                        const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                        const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)
                        const startBrokerBalance = new BN(await web3.eth.getBalance(broker.address))
                        const startBurnedBalance = new BN(await web3.eth.getBalance(constants.NULL_ADDRESS))

                        const txResult = await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                        const txCost = await calcTxCost(txResult)
                        const blockReward = new BN(web3.utils.toWei("3", "ether"))
                        const burnAddressGanacheUpdates = txCost.add(blockReward)
                        const endBrokerBalance = new BN(await web3.eth.getBalance(broker.address))
                        const endBurnedBalance = new BN(await web3.eth.getBalance(constants.NULL_ADDRESS))

                        assert.equal(startBrokerBalance.sub(endBrokerBalance).toString(), deposit.toString())
                        assert.equal(endBurnedBalance.sub(startBurnedBalance).sub(burnAddressGanacheUpdates), "0")
                        truffleAssert.eventNotEmitted(txResult, "PenaltyEscrowSlashed")
                    })
                })

                describe("sender.penaltyEscrow is not zero", () => {
                    it("burns sender.penaltyEscrow", async () => {
                        const deposit = 500
                        await broker.fundDeposit({from: sender, value: deposit})
                        const penaltyEscrow = 2000
                        await broker.fundPenaltyEscrow({from: sender, value: penaltyEscrow})

                        const recipientRand = 5
                        const faceValue = 1000
                        const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                        const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)
                        const startBrokerBalance = new BN(await web3.eth.getBalance(broker.address))
                        const startBurnedBalance = new BN(await web3.eth.getBalance(constants.NULL_ADDRESS))

                        const txRes = await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                        const txCost = await calcTxCost(txRes)
                        const blockReward = new BN(web3.utils.toWei("3", "ether"))
                        const burnAddressGanacheUpdates = txCost.add(blockReward)

                        const endBrokerBalance = new BN(await web3.eth.getBalance(broker.address))
                        const endBurnedBalance = new BN(await web3.eth.getBalance(constants.NULL_ADDRESS))
                        const endPenaltyEscrow = (await broker.senders.call(sender)).penaltyEscrow.toString()

                        assert.equal(startBrokerBalance.sub(endBrokerBalance).toString(), (deposit + penaltyEscrow).toString())
                        assert.equal(endBurnedBalance.sub(startBurnedBalance).sub(burnAddressGanacheUpdates).toString(), penaltyEscrow.toString())
                        assert.equal(endPenaltyEscrow, "0")
                    })

                    it("emits a PenaltyEscrowSlashed event", async () => {
                        const deposit = 500
                        await broker.fundDeposit({from: sender, value: deposit})
                        const penaltyEscrow = 2000
                        await broker.fundPenaltyEscrow({from: sender, value: penaltyEscrow})

                        const recipientRand = 5
                        const faceValue = 1000
                        const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                        const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

                        const txRes = await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                        truffleAssert.eventEmitted(txRes, "PenaltyEscrowSlashed", ev => {
                            return ev.sender === sender && ev.recipient == recipient && ev.amount.toString() === penaltyEscrow.toString()
                        })
                    })

                    // TODO: tests for indexed arguments in PenaltyEscrowSlashed
                })
            })
        })

        it("does not transfer sender.deposit to recipient when faceValue is zero", async () => {
            const deposit = 1500
            await broker.fundDeposit({from: sender, value: deposit})

            const recipientRand = 5
            const ticket = createWinningTicket(recipient, sender, recipientRand)
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)
            const startBrokerBalance = new BN(await web3.eth.getBalance(broker.address))
            const startRecipientBalance = new BN(await web3.eth.getBalance(recipient))

            const txResult = await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

            const txCost = await calcTxCost(txResult)
            const endBrokerBalance = new BN(await web3.eth.getBalance(broker.address))
            const endRecipientBalance = new BN(await web3.eth.getBalance(recipient))
            const endDeposit = (await broker.senders.call(sender)).deposit.toString()

            assert.equal(startBrokerBalance.sub(endBrokerBalance).toString(), "0")
            assert.equal(endRecipientBalance.sub(startRecipientBalance).add(txCost).toString(), "0")
            assert.equal(endDeposit, deposit.toString())
            truffleAssert.eventNotEmitted(txResult, "WinningTicketTransfer")
        })

        it("transfers faceValue to recipient when deposit > faceValue", async () => {
            const deposit = 1500
            await broker.fundDeposit({from: sender, value: deposit})

            const recipientRand = 5
            const faceValue = 1000
            const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)
            const startBrokerBalance = new BN(await web3.eth.getBalance(broker.address))
            const startRecipientBalance = new BN(await web3.eth.getBalance(recipient))

            const txResult = await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

            const txCost = await calcTxCost(txResult)
            const endBrokerBalance = new BN(await web3.eth.getBalance(broker.address))
            const endRecipientBalance = new BN(await web3.eth.getBalance(recipient))
            const endDeposit = (await broker.senders.call(sender)).deposit.toString()

            assert.equal(startBrokerBalance.sub(endBrokerBalance).toString(), faceValue.toString())
            assert.equal(endRecipientBalance.sub(startRecipientBalance).add(txCost).toString(), faceValue.toString())
            assert.equal(endDeposit, (deposit - faceValue).toString())
        })

        it("transfers faceValue to recipient when deposit == faceValue", async () => {
            const deposit = 1500
            await broker.fundDeposit({from: sender, value: deposit})

            const recipientRand = 5
            const faceValue = 1500
            const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)
            const startBrokerBalance = new BN(await web3.eth.getBalance(broker.address))
            const startRecipientBalance = new BN(await web3.eth.getBalance(recipient))

            const txResult = await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

            const txCost = await calcTxCost(txResult)
            const endBrokerBalance = new BN(await web3.eth.getBalance(broker.address))
            const endRecipientBalance = new BN(await web3.eth.getBalance(recipient))
            const endDeposit = (await broker.senders.call(sender)).deposit.toString()

            assert.equal(startBrokerBalance.sub(endBrokerBalance).toString(), faceValue.toString())
            assert.equal(endRecipientBalance.sub(startRecipientBalance).add(txCost).toString(), faceValue.toString())
            assert.equal(endDeposit, (deposit - faceValue).toString())
        })

        it("emits a WinningTicketRedeemed event", async () => {
            const deposit = 1500
            await broker.fundDeposit({from: sender, value: deposit})

            const recipientRand = 5
            const faceValue = 1500
            const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

            const txResult = await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

            truffleAssert.eventEmitted(txResult, "WinningTicketRedeemed", ev => {
                return ev.sender === sender
                    && ev.recipient === recipient
                    && ev.faceValue.toString() === ticket.faceValue.toString()
                    && ev.winProb.toString() === ticket.winProb.toString()
                    && ev.senderNonce.toString() === ticket.senderNonce.toString()
                    && ev.recipientRand.toString() === recipientRand.toString()
                    && ev.auxData === ticket.auxData
            })
        })

        it("emits a WinningTicketRedeemed event with indexed sender", async () => {
            const sender2 = accounts[2]
            const deposit = 1500
            await broker.fundDeposit({from: sender, value: deposit})
            await broker.fundDeposit({from: sender2, value: deposit})

            const recipientRand = 5
            const faceValue = 1500
            const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
            const ticket2 = createWinningTicket(recipient, sender2, recipientRand, faceValue)
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)
            const senderSig2 = await web3.eth.sign(getTicketHash(ticket2), sender2)
            const fromBlock = (await web3.eth.getBlock("latest")).number

            await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})
            await broker.redeemWinningTicket(ticket2, senderSig2, recipientRand, {from: recipient})

            const events = await broker.getPastEvents("WinningTicketRedeemed", {
                filter: {
                    sender
                },
                fromBlock,
                toBlock: "latest"
            })

            assert.equal(events.length, 1)
            assert.equal(events[0].returnValues.sender, sender)
        })

        it("emits a WinningTicketRedeemed event with indexed recipient", async () => {
            const recipient2 = accounts[2]
            const deposit = 1500
            await broker.fundDeposit({from: sender, value: deposit})

            const recipientRand = 5
            const faceValue = 200
            const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
            const ticket2 = createWinningTicket(recipient2, sender, recipientRand, faceValue)
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)
            const senderSig2 = await web3.eth.sign(getTicketHash(ticket2), sender)
            const fromBlock = (await web3.eth.getBlock("latest")).number

            await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})
            await broker.redeemWinningTicket(ticket2, senderSig2, recipientRand, {from: recipient2})

            const events = await broker.getPastEvents("WinningTicketRedeemed", {
                filter: {
                    recipient
                },
                fromBlock,
                toBlock: "latest"
            })

            assert.equal(events.length, 1)
            assert.equal(events[0].returnValues.recipient, recipient)
        })
    })

    describe("unlock", () => {
        it("reverts when both deposit and penaltyEscrow are zero", async () => {
            await expectRevertWithReason(broker.unlock(), "sender deposit and penalty escrow are zero")
        })

        it("reverts when called twice", async () => {
            await broker.fundDeposit({from: sender, value: 1000})
            await broker.unlock()

            await expectRevertWithReason(broker.unlock(), "unlock already initiated")
        })

        it("reverts when called twice by multiple senders", async () => {
            const sender2 = accounts[2]
            await broker.fundDeposit({from: sender, value: 1000})
            await broker.fundDeposit({from: sender2, value: 2000})
            await broker.unlock({from: sender})
            await broker.unlock({from: sender2})

            await expectRevertWithReason(broker.unlock({from: sender}), "unlock already initiated")
            await expectRevertWithReason(broker.unlock({from: sender2}), "unlock already initiated")
        })

        it("sets withdrawBlock according to constructor config", async () => {
            await broker.fundDeposit({from: sender, value: 1000})
            const fromBlock = (await web3.eth.getBlock("latest")).number

            await broker.unlock({from: sender})

            const withdrawBlock = (await broker.senders.call(sender)).withdrawBlock.toString()
            const expectedWithdrawBlock = fromBlock + unlockPeriod + 1 // +1 to account for the block created executing unlock
            assert.equal(withdrawBlock, expectedWithdrawBlock.toString())
        })

        it("sets isUnlockInProgress to true", async () => {
            await broker.fundDeposit({from: sender, value: 1000})

            await broker.unlock({from: sender})

            const isUnlockInProgress = await broker.isUnlockInProgress.call(sender)
            assert(isUnlockInProgress)
        })

        it("emits an Unlock event", async () => {
            await broker.fundDeposit({from: sender, value: 1000})
            const expectedStartBlock = (await web3.eth.getBlock("latest")).number + 1
            const expectedEndBlock = expectedStartBlock + unlockPeriod

            const txResult = await broker.unlock({from: sender})

            truffleAssert.eventEmitted(txResult, "Unlock", ev => {
                return ev.sender === sender &&
                    ev.startBlock.toString() === expectedStartBlock.toString() &&
                    ev.endBlock.toString() === expectedEndBlock.toString()
            })
        })

        it("emits an Unlock event indexed by sender", async () => {
            const fromBlock = (await web3.eth.getBlock("latest")).number
            await broker.fundDeposit({from: sender, value: 1000})

            await broker.unlock({from: sender})

            const events = await broker.getPastEvents("Unlock", {
                filter: {
                    sender
                },
                fromBlock,
                toBlock: "latest"
            })
            assert.equal(events.length, 1)
            const event = events[0]
            assert.equal(event.returnValues.sender, sender)
        })
    })

    describe("cancelUnlock", () => {
        it("reverts if sender is not in an unlocking state", async () => {
            await expectRevertWithReason(broker.cancelUnlock(), "no unlock request in progress")
        })

        it("sets isUnlockInProgress to false", async () => {
            await broker.fundDeposit({from: sender, value: 1000})
            await broker.unlock()

            await broker.cancelUnlock()

            const isUnlockInProgress = await broker.isUnlockInProgress.call(sender)
            assert.equal(isUnlockInProgress, false)
        })

        it("prevents withdrawal", async () => {
            await broker.fundDeposit({from: sender, value: 1000})
            await broker.unlock()
            await fixture.rpc.wait(unlockPeriod)

            await broker.cancelUnlock()

            await expectRevertWithReason(broker.withdraw(), "account is locked")
        })

        it("emits an UnlockCancelled event", async () => {
            await broker.fundDeposit({from: sender, value: 1000})
            await broker.unlock()

            const txResult = await broker.cancelUnlock()

            truffleAssert.eventEmitted(txResult, "UnlockCancelled", ev => {
                return ev.sender === sender
            })
        })

        it("emits an UnlockCancelled event with an indexed sender", async () => {
            await broker.fundDeposit({from: sender, value: 1000})
            const fromBlock = (await web3.eth.getBlock("latest")).number
            await broker.unlock()

            await broker.cancelUnlock()

            const events = await broker.getPastEvents("UnlockCancelled", {
                filter: {
                    sender
                },
                fromBlock,
                toBlock: "latest"
            })
            assert.equal(events.length, 1)
            const event = events[0]
            assert.equal(event.returnValues.sender, sender)
        })
    })

    describe("withdraw", () => {
        it("reverts when both deposit and penaltyEscrow are zero", async () => {
            await expectRevertWithReason(broker.withdraw(), "sender deposit and penalty escrow are zero")
        })

        it("reverts when account is locked", async () => {
            await broker.fundDeposit({from: sender, value: 1000})

            await expectRevertWithReason(broker.withdraw(), "account is locked")
        })

        it("sets deposit and penaltyEscrow to zero", async () => {
            await broker.fundDeposit({from: sender, value: 1000})
            await broker.fundPenaltyEscrow({from: sender, value: 2000})
            await broker.unlock({from: sender})
            await fixture.rpc.wait(unlockPeriod)

            await broker.withdraw({from: sender})

            const deposit = (await broker.senders.call(sender)).deposit.toString()
            const penaltyEscrow = (await broker.senders.call(sender)).penaltyEscrow.toString()
            assert.equal(deposit, "0")
            assert.equal(penaltyEscrow, "0")
        })

        it("transfers the sum of deposit and penaltyEscrow to sender", async () => {
            const deposit = 1000
            const penaltyEscrow = 2000
            await broker.fundDeposit({from: sender, value: deposit})
            await broker.fundPenaltyEscrow({from: sender, value: penaltyEscrow})
            await broker.unlock({from: sender})
            await fixture.rpc.wait(unlockPeriod)
            const startBalance = new BN(await web3.eth.getBalance(sender))

            const txResult = await broker.withdraw({from: sender})

            const txCost = await calcTxCost(txResult)
            const endBalance = new BN(await web3.eth.getBalance(sender))
            assert.equal(endBalance.sub(startBalance).add(txCost).toString(), (deposit + penaltyEscrow).toString())
        })

        it("completes withdrawal when deposit == 0", async () => {
            const penaltyEscrow = 2000
            await broker.fundPenaltyEscrow({from: sender, value: penaltyEscrow})
            await broker.unlock({from: sender})
            await fixture.rpc.wait(unlockPeriod)
            const startBalance = new BN(await web3.eth.getBalance(sender))

            const txResult = await broker.withdraw({from: sender})

            const txCost = await calcTxCost(txResult)
            const endBalance = new BN(await web3.eth.getBalance(sender))
            assert.equal(endBalance.sub(startBalance).add(txCost).toString(), penaltyEscrow.toString())
        })

        it("completes withdrawal when penaltyEscrow == 0", async () => {
            const deposit = 1000
            await broker.fundDeposit({from: sender, value: deposit})
            await broker.unlock({from: sender})
            await fixture.rpc.wait(unlockPeriod)
            const startBalance = new BN(await web3.eth.getBalance(sender))

            const txResult = await broker.withdraw({from: sender})

            const txCost = await calcTxCost(txResult)
            const endBalance = new BN(await web3.eth.getBalance(sender))
            assert.equal(endBalance.sub(startBalance).add(txCost).toString(), deposit.toString())
        })

        it("emits a Withdrawal event", async () => {
            const deposit = 1000
            const penaltyEscrow = 2000
            await broker.fundDeposit({from: sender, value: deposit})
            await broker.fundPenaltyEscrow({from: sender, value: penaltyEscrow})
            await broker.unlock({from: sender})
            await fixture.rpc.wait(unlockPeriod)

            const txResult = await broker.withdraw({from: sender})
       
            truffleAssert.eventEmitted(txResult, "Withdrawal", ev => {
                return ev.sender === sender &&
                    ev.deposit.toString() === deposit.toString() &&
                    ev.penaltyEscrow.toString() === penaltyEscrow.toString()
            })
        })

        it("emits a Withdrawal event with indexed sender", async () => {
            const fromBlock = (await web3.eth.getBlock("latest")).number
            const deposit = 1000
            const penaltyEscrow = 2000
            await broker.fundDeposit({from: sender, value: deposit})
            await broker.fundPenaltyEscrow({from: sender, value: penaltyEscrow})
            await broker.unlock({from: sender})
            await fixture.rpc.wait(unlockPeriod)

            await broker.withdraw({from: sender})

            const events = await broker.getPastEvents("Withdrawal", {
                filter: {
                    sender
                },
                fromBlock,
                toBlock: "latest"
            })

            assert.equal(events.length, 1)
            const event = events[0]
            assert.equal(event.returnValues.sender, sender)
            assert.equal(event.returnValues.deposit.toString(), deposit.toString())
            assert.equal(event.returnValues.penaltyEscrow.toString(), penaltyEscrow.toString())
        })
    })
})
