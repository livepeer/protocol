import BN from "bn.js"
import truffleAssert from "truffle-assertions"
import calcTxCost from "../helpers/calcTxCost"
import expectThrow from "../helpers/expectThrow"
import {expectRevertWithReason} from "../helpers/expectFail"
import {createTicket, createWinningTicket, getTicketHash} from "../helpers/ticket"
import {constants} from "../../utils/constants"

const TicketBroker = artifacts.require("ETHTicketBroker")

contract("TicketBroker", accounts => {
    let broker

    const sender = accounts[0]
    const recipient = accounts[1]

    beforeEach(async () => {
        broker = await TicketBroker.new(0)
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
            broker = await TicketBroker.new(web3.utils.toWei(".5", "ether"))

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
})
