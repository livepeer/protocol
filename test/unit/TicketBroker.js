import BN from "bn.js"
import truffleAssert from "truffle-assertions"
import calcTxCost from "../helpers/calcTxCost"
import {expectRevertWithReason} from "../helpers/expectFail"
import {wrapRedeemWinningTicket, createTicket, createWinningTicket, getTicketHash} from "../helpers/ticket"
import Fixture from "./helpers/Fixture"

const TicketBroker = artifacts.require("ETHTicketBroker")

contract("TicketBroker", accounts => {
    let broker
    let fixture
    let redeemWinningTicket

    const sender = accounts[0]
    const recipient = accounts[1]

    const unlockPeriod = 20
    const signerRevocationPeriod = 20

    before(async () => {
        fixture = new Fixture(web3)
        await fixture.deploy()

        broker = await TicketBroker.new(unlockPeriod, signerRevocationPeriod)

        redeemWinningTicket = wrapRedeemWinningTicket(broker)
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
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

    describe("fundReserve", () => {
        it("grows the broker's ETH balance", async () => {
            await broker.fundReserve({from: sender, value: 1000})

            const balance = await web3.eth.getBalance(broker.address)

            assert.equal(balance, "1000")
        })

        it("reduces the sender's ETH balance", async () => {
            const startBalance = new BN(await web3.eth.getBalance(sender))

            const txRes = await broker.fundReserve({from: sender, value: 1000})

            const endBalance = new BN(await web3.eth.getBalance(sender))
            const txCost = await calcTxCost(txRes)

            assert.equal(startBalance.sub(endBalance).sub(txCost).toString(), "1000")
        })

        it("tracks the sender's ETH reserve", async () => {
            await broker.fundReserve({from: sender, value: 1000})

            const reserve = (await broker.getReserve(sender)).fundsAdded.toString()

            assert.equal(reserve, "1000")
        })

        it("tracks sender's multiple penalty escrow fundings", async () => {
            await broker.fundReserve({from: sender, value: 1000})
            await broker.fundReserve({from: sender, value: 500})

            const reserve = (await broker.getReserve(sender)).fundsAdded.toString()

            assert.equal(reserve, "1500")
        })

        it("track multiple sender's reserves", async () => {
            const sender2 = accounts[2]
            await broker.fundReserve({from: sender, value: 1000})
            await broker.fundReserve({from: sender2, value: 500})

            const reserve = (await broker.getReserve(sender)).fundsAdded.toString()
            const reserve2 = (await broker.getReserve(sender2)).fundsAdded.toString()

            assert.equal(reserve, "1000")
            assert.equal(reserve2, "500")
        })

        it("resets an unlock request in progress", async () => {
            await broker.fundReserve({from: sender, value: 1000})
            await broker.unlock()

            await broker.fundReserve({from: sender, value: 500})

            const isUnlockInProgress = await broker.isUnlockInProgress.call(sender)
            assert(!isUnlockInProgress)
        })

        it("emits a ReserveFunded event", async () => {
            const txResult = await broker.fundReserve({from: sender, value: 1000})

            truffleAssert.eventEmitted(txResult, "ReserveFunded", ev => {
                return ev.sender === sender && ev.amount.toString() === "1000"
            })
        })

        it("emits a ReserveFunded event with indexed sender", async () => {
            const sender2 = accounts[2]
            const fromBlock = (await web3.eth.getBlock("latest")).number
            await broker.fundReserve({from: sender, value: 1000})
            await broker.fundReserve({from: sender2, value: 1000})

            const events = await broker.getPastEvents("ReserveFunded", {
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

    describe("isApprovedSigner", () => {
        it("returns false for a signer that was never approved", async () => {
            assert(!await broker.isApprovedSigner(sender, accounts[2]))
        })
    })

    describe("approveSigners", () => {
        const signers = accounts.slice(2, 4)

        it("approves addresses as signers for sender", async () => {
            await broker.approveSigners(signers, {from: sender})

            assert(await broker.isApprovedSigner(sender, signers[0]))
            assert(await broker.isApprovedSigner(sender, signers[1]))
        })

        it("re-approves signers that were revoked", async () => {
            await broker.approveSigners(signers, {from: sender})
            await broker.requestSignersRevocation(signers, {from: sender})
            await fixture.rpc.wait(signerRevocationPeriod)

            await broker.approveSigners(signers, {from: sender})

            assert(await broker.isApprovedSigner(sender, signers[0]))
            assert(await broker.isApprovedSigner(sender, signers[1]))
        })

        it("emits a SignersApproved event", async () => {
            const txResult = await broker.approveSigners(signers, {from: sender})

            truffleAssert.eventEmitted(txResult, "SignersApproved", ev => {
                return ev.sender === sender
                    && ev.approvedSigners[0] === signers[0]
                    && ev.approvedSigners[1] === signers[1]
            })
        })

        it("emits a SignersApproved event with indexed sender", async () => {
            const sender2 = accounts[4]
            const fromBlock = (await web3.eth.getBlock("latest")).number
            await broker.approveSigners(signers, {from: sender})
            await broker.approveSigners(signers, {from: sender2})

            const events = await broker.getPastEvents("SignersApproved", {
                filter: {
                    sender
                },
                fromBlock,
                toBlock: "latest"
            })

            assert.equal(events.length, 1)
            assert.equal(events[0].returnValues.sender, sender)
            assert.equal(events[0].returnValues.approvedSigners[0], signers[0])
            assert.equal(events[0].returnValues.approvedSigners[1], signers[1])
        })
    })

    describe("requestSignersRevocation", () => {
        const signers = accounts.slice(2, 4)

        it("revokes signers when block.number == revocationBlock", async () => {
            await broker.approveSigners(signers, {from: sender})

            await broker.requestSignersRevocation(signers, {from: sender})
            // We have to wait one block less because when calling isApprovedSigner later
            // the ETH client sets block.number to a the *next unmined* block number
            // rather than the current/already-mined block number.
            await fixture.rpc.wait(signerRevocationPeriod - 1)

            assert(!await broker.isApprovedSigner(sender, signers[0]))
            assert(!await broker.isApprovedSigner(sender, signers[1]))
        })

        it("revokes signers when block.number > revocationBlock", async () => {
            await broker.approveSigners(signers, {from: sender})

            await broker.requestSignersRevocation(signers, {from: sender})
            await fixture.rpc.wait(signerRevocationPeriod + 10)

            assert(!await broker.isApprovedSigner(sender, signers[0]))
            assert(!await broker.isApprovedSigner(sender, signers[1]))
        })

        it("does not revokes signers before signerRevocationPeriod elapses", async () => {
            await broker.approveSigners(signers, {from: sender})

            await broker.requestSignersRevocation(signers, {from: sender})

            assert(await broker.isApprovedSigner(sender, signers[0]))
            assert(await broker.isApprovedSigner(sender, signers[1]))
        })

        it("supports revoking only one signer", async () => {
            await broker.approveSigners(signers, {from: sender})

            await broker.requestSignersRevocation([signers[1]], {from: sender})
            await fixture.rpc.wait(signerRevocationPeriod)

            assert(!await broker.isApprovedSigner(sender, signers[1]))
            assert(await broker.isApprovedSigner(sender, signers[0]))
        })

        it("revokes signers even if they were never approved", async () => {
            await broker.requestSignersRevocation(signers, {from: sender})
            await fixture.rpc.wait(signerRevocationPeriod)

            assert(!await broker.isApprovedSigner(sender, signers[0]))
            assert(!await broker.isApprovedSigner(sender, signers[1]))
        })

        it("emits a SignersRevocationRequested event", async () => {
            const startBlock = (await web3.eth.getBlock("latest")).number + 1
            const expectedRevocationBlock = startBlock + signerRevocationPeriod
            const txResult = await broker.requestSignersRevocation(signers, {from: sender})

            truffleAssert.eventEmitted(txResult, "SignersRevocationRequested", ev => {
                return ev.sender === sender
                    && ev.signers[0] === signers[0]
                    && ev.signers[1] === signers[1]
                    && ev.revocationBlock.toString() === expectedRevocationBlock.toString()
            })
        })

        it("emits a SignersRevocationRequested event with indexed sender", async () => {
            const startBlock = (await web3.eth.getBlock("latest")).number + 1
            const expectedRevocationBlock = startBlock + signerRevocationPeriod
            await broker.requestSignersRevocation(signers, {from: sender})

            const events = await broker.getPastEvents("SignersRevocationRequested", {
                filter: {
                    sender
                },
                fromBlock: startBlock,
                toBlock: "latest"
            })

            assert.equal(events.length, 1)
            assert.equal(events[0].returnValues.sender, sender)
            assert.equal(events[0].returnValues.signers[0], signers[0])
            assert.equal(events[0].returnValues.signers[1], signers[1])
            assert.equal(events[0].returnValues.revocationBlock.toString(), expectedRevocationBlock.toString())
        })
    })

    describe("fundAndApproveSigners", () => {
        const signers = accounts.slice(2, 4)

        it("reverts if msg.value < sum of deposit amount and reserve amount", async () => {
            const deposit = 500
            const reserve = 1000

            await expectRevertWithReason(
                broker.fundAndApproveSigners(
                    deposit,
                    reserve,
                    signers,
                    {from: sender, value: deposit + reserve - 1}
                ),
                "msg.value does not equal sum of deposit amount and reserve amount"
            )
        })

        it("reverts if msg.value > sum of deposit amount and reserve amount", async () => {
            const deposit = 500
            const reserve = 1000

            await expectRevertWithReason(
                broker.fundAndApproveSigners(
                    deposit,
                    reserve,
                    signers,
                    {from: sender, value: deposit + reserve + 1}
                ),
                "msg.value does not equal sum of deposit amount and reserve amount"
            )
        })

        it("approves addresses as signers for sender", async () => {
            const deposit = 500
            const reserve = 1000

            await broker.fundAndApproveSigners(
                deposit,
                reserve,
                signers,
                {from: sender, value: deposit + reserve}
            )

            assert(await broker.isApprovedSigner(sender, signers[0]))
            assert(await broker.isApprovedSigner(sender, signers[1]))
        })

        it("grows the broker's ETH balance by sum of deposit and reserve amounts", async () => {
            const deposit = 500
            const reserve = 1000
            const startBrokerBalance = new BN(await web3.eth.getBalance(broker.address))

            await broker.fundAndApproveSigners(
                deposit,
                reserve,
                signers,
                {from: sender, value: deposit + reserve}
            )

            const endBrokerBalance = new BN(await web3.eth.getBalance(broker.address))

            assert.equal(endBrokerBalance.sub(startBrokerBalance).toString(), (deposit + reserve).toString())
        })

        it("reduces the sender's ETH balance by sum of deposit and reserve amounts", async () => {
            const deposit = 500
            const reserve = 1000
            const startSenderBalance = new BN(await web3.eth.getBalance(sender))

            const txResult = await broker.fundAndApproveSigners(
                deposit,
                reserve,
                signers,
                {from: sender, value: deposit + reserve}
            )

            const endSenderBalance = new BN(await web3.eth.getBalance(sender))
            const txCost = await calcTxCost(txResult)

            assert.equal(startSenderBalance.sub(endSenderBalance).sub(txCost).toString(), (deposit + reserve).toString())
        })

        it("tracks sender's ETH deposit and reserve", async () => {
            const deposit = 500
            const reserve = 1000

            await broker.fundAndApproveSigners(
                deposit,
                reserve,
                signers,
                {from: sender, value: deposit + reserve}
            )

            const endSender = await broker.senders.call(sender)
            const endReserve = await broker.getReserve(sender)

            assert.equal(endSender.deposit.toString(), deposit.toString())
            assert.equal(endReserve.fundsAdded.toString(), reserve.toString())
        })
    })

    describe("redeemWinningTicket", () => {
        it("reverts if ticket's recipient is null address", async () => {
            await expectRevertWithReason(
                redeemWinningTicket(
                    createTicket(),
                    web3.utils.asciiToHex("sig"),
                    5
                ),
                "ticket recipient is null address"
            )
        })

        it("reverts if ticket sender is null address", async () => {
            await expectRevertWithReason(
                redeemWinningTicket(
                    createTicket({recipient}),
                    web3.utils.asciiToHex("sig"),
                    5
                ),
                "ticket sender is null address"
            )
        })

        it("reverts if ticket is expired", async () => {
            await expectRevertWithReason(
                redeemWinningTicket(
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
                redeemWinningTicket(
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

            await redeemWinningTicket(ticket, senderSig, recipientRand)

            assert.isOk(await broker.usedTickets.call(ticketHash))
            await expectRevertWithReason(
                redeemWinningTicket(
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
                redeemWinningTicket(
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
                redeemWinningTicket(
                    ticket,
                    senderSig,
                    recipientRand
                ),
                "ticket did not win"
            )
        })

        it("reverts if sender's deposit and reserve are zero", async () => {
            const recipientRand = 5
            const ticket = createWinningTicket(recipient, sender, recipientRand)
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

            await expectRevertWithReason(
                redeemWinningTicket(
                    ticket,
                    senderSig,
                    recipientRand
                ),
                "sender deposit and reserve are zero"
            )
        })

        describe("deposit < faceValue", () => {
            describe("sender.deposit is zero", () => {
                it("does not transfer sender.deposit to recipient", async () => {
                    const reserve = 2000
                    await broker.fundReserve({from: sender, value: reserve})

                    const recipientRand = 5
                    const faceValue = 1000
                    const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                    const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)
                    const startRecipientBalance = new BN(await web3.eth.getBalance(recipient))

                    const txResult = await redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                    const txCost = await calcTxCost(txResult)
                    const endRecipientBalance = new BN(await web3.eth.getBalance(recipient))

                    assert.equal(endRecipientBalance.sub(startRecipientBalance).add(txCost).toString(), "0")
                    truffleAssert.eventNotEmitted(txResult, "WinningTicketTransfer")
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

                    const txResult = await redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

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

                    const txResult = await redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                    truffleAssert.eventEmitted(txResult, "WinningTicketTransfer", ev => {
                        return ev.sender === sender && ev.recipient === recipient && ev.amount.toString() === deposit.toString()
                    })
                })

                // TODO: tests for indexed arguments in WinningTicketTransfer

                describe("sender.reserve is zero", () => {

                })

                describe("sender.reserve is not zero", () => {

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

            const txResult = await redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

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

            const txResult = await redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

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

            const txResult = await redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

            const txCost = await calcTxCost(txResult)
            const endBrokerBalance = new BN(await web3.eth.getBalance(broker.address))
            const endRecipientBalance = new BN(await web3.eth.getBalance(recipient))
            const endDeposit = (await broker.senders.call(sender)).deposit.toString()

            assert.equal(startBrokerBalance.sub(endBrokerBalance).toString(), faceValue.toString())
            assert.equal(endRecipientBalance.sub(startRecipientBalance).add(txCost).toString(), faceValue.toString())
            assert.equal(endDeposit, (deposit - faceValue).toString())
        })

        it("accepts signature from a sender's approved signer", async () => {
            const signer = accounts[2]
            const deposit = 1500
            await broker.fundDeposit({from: sender, value: deposit})
            await broker.approveSigners([signer], {from: sender})

            const recipientRand = 5
            const faceValue = 1000
            const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
            const senderSig = await web3.eth.sign(getTicketHash(ticket), signer)
            const startBrokerBalance = new BN(await web3.eth.getBalance(broker.address))
            const startRecipientBalance = new BN(await web3.eth.getBalance(recipient))

            const txResult = await redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

            const txCost = await calcTxCost(txResult)
            const endBrokerBalance = new BN(await web3.eth.getBalance(broker.address))
            const endRecipientBalance = new BN(await web3.eth.getBalance(recipient))
            const endDeposit = (await broker.senders.call(sender)).deposit.toString()

            assert.equal(startBrokerBalance.sub(endBrokerBalance).toString(), faceValue.toString())
            assert.equal(endRecipientBalance.sub(startRecipientBalance).add(txCost).toString(), faceValue.toString())
            assert.equal(endDeposit, (deposit - faceValue).toString())
        })

        it("can be called by an account that is not the recipient", async () => {
            const thirdParty = accounts[2]
            const deposit = 1500
            await broker.fundDeposit({from: sender, value: deposit})

            const recipientRand = 5
            const faceValue = 1000
            const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)
            const startBrokerBalance = new BN(await web3.eth.getBalance(broker.address))
            const startRecipientBalance = new BN(await web3.eth.getBalance(recipient))

            await redeemWinningTicket(ticket, senderSig, recipientRand, {from: thirdParty})

            const endBrokerBalance = new BN(await web3.eth.getBalance(broker.address))
            const endRecipientBalance = new BN(await web3.eth.getBalance(recipient))
            const endDeposit = (await broker.senders.call(sender)).deposit.toString()

            assert.equal(startBrokerBalance.sub(endBrokerBalance).toString(), faceValue.toString())
            assert.equal(endRecipientBalance.sub(startRecipientBalance).toString(), faceValue.toString())
            assert.equal(endDeposit, (deposit - faceValue).toString())
        })

        it("emits a WinningTicketRedeemed event", async () => {
            const deposit = 1500
            await broker.fundDeposit({from: sender, value: deposit})

            const recipientRand = 5
            const faceValue = 1500
            const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

            const txResult = await redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

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

            await redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})
            await redeemWinningTicket(ticket2, senderSig2, recipientRand, {from: recipient})

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

            await redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})
            await redeemWinningTicket(ticket2, senderSig2, recipientRand, {from: recipient2})

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
        it("reverts when both deposit and reserve are zero", async () => {
            await expectRevertWithReason(broker.unlock(), "sender deposit and reserve are zero")
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

            await broker.unlock({from: sender})

            const fromBlock = (await web3.eth.getBlock("latest")).number
            const expectedWithdrawBlock = fromBlock + unlockPeriod
            const withdrawBlock = (await broker.senders.call(sender)).withdrawBlock.toString()
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
            assert(!isUnlockInProgress)
        })

        it("prevents withdrawal", async () => {
            await broker.fundDeposit({from: sender, value: 1000})
            await broker.unlock()
            await fixture.rpc.wait(unlockPeriod)

            await broker.cancelUnlock()

            await expectRevertWithReason(broker.withdraw(), "no unlock request in progress")
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
        it("reverts when both deposit and reserve are zero", async () => {
            await expectRevertWithReason(broker.withdraw(), "sender deposit and reserve are zero")
        })

        it("reverts when no unlock request has been started", async () => {
            await broker.fundDeposit({from: sender, value: 1000})

            await expectRevertWithReason(broker.withdraw(), "no unlock request in progress")
        })

        it("reverts when account is locked", async () => {
            await broker.fundDeposit({from: sender, value: 1000})
            await broker.unlock({from: sender})

            await expectRevertWithReason(broker.withdraw(), "account is locked")
        })

        it("sets deposit and reserve to zero", async () => {
            await broker.fundDeposit({from: sender, value: 1000})
            await broker.fundReserve({from: sender, value: 2000})
            await broker.unlock({from: sender})
            await fixture.rpc.wait(unlockPeriod)

            await broker.withdraw({from: sender})

            const deposit = (await broker.senders.call(sender)).deposit.toString()
            const reserve = (await broker.getReserve(sender)).fundsAdded.toString()
            assert.equal(deposit, "0")
            assert.equal(reserve, "0")
        })

        it("transfers the sum of deposit and reserve to sender", async () => {
            const deposit = 1000
            const reserve = 2000
            await broker.fundDeposit({from: sender, value: deposit})
            await broker.fundReserve({from: sender, value: reserve})
            await broker.unlock({from: sender})
            await fixture.rpc.wait(unlockPeriod)
            const startBalance = new BN(await web3.eth.getBalance(sender))

            const txResult = await broker.withdraw({from: sender})

            const txCost = await calcTxCost(txResult)
            const endBalance = new BN(await web3.eth.getBalance(sender))
            assert.equal(endBalance.sub(startBalance).add(txCost).toString(), (deposit + reserve).toString())
        })

        it("completes withdrawal when deposit == 0", async () => {
            const reserve = 2000
            await broker.fundReserve({from: sender, value: reserve})
            await broker.unlock({from: sender})
            await fixture.rpc.wait(unlockPeriod)
            const startBalance = new BN(await web3.eth.getBalance(sender))

            const txResult = await broker.withdraw({from: sender})

            const txCost = await calcTxCost(txResult)
            const endBalance = new BN(await web3.eth.getBalance(sender))
            assert.equal(endBalance.sub(startBalance).add(txCost).toString(), reserve.toString())
        })

        it("completes withdrawal when reserve == 0", async () => {
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
            const reserve = 2000
            await broker.fundDeposit({from: sender, value: deposit})
            await broker.fundReserve({from: sender, value: reserve})
            await broker.unlock({from: sender})
            await fixture.rpc.wait(unlockPeriod)

            const txResult = await broker.withdraw({from: sender})

            truffleAssert.eventEmitted(txResult, "Withdrawal", ev => {
                return ev.sender === sender &&
                    ev.deposit.toString() === deposit.toString() &&
                    ev.reserve.toString() === reserve.toString()
            })
        })

        it("emits a Withdrawal event with indexed sender", async () => {
            const fromBlock = (await web3.eth.getBlock("latest")).number
            const deposit = 1000
            const reserve = 2000
            await broker.fundDeposit({from: sender, value: deposit})
            await broker.fundReserve({from: sender, value: reserve})
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
            assert.equal(event.returnValues.reserve.toString(), reserve.toString())
        })
    })
})
