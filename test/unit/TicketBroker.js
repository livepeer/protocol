import BN from "bn.js"
import truffleAssert from "truffle-assertions"
import calcTxCost from "../helpers/calcTxCost"
import expectRevertWithReason from "../helpers/expectFail"
import {
    DUMMY_TICKET_CREATION_ROUND,
    DUMMY_TICKET_CREATION_ROUND_BLOCK_HASH,
    createAuxData,
    createTicket,
    createWinningTicket,
    getTicketHash
} from "../helpers/ticket"
import Fixture from "./helpers/Fixture"
import {functionSig} from "../../utils/helpers"
import {constants} from "../../utils/constants"

const TicketBroker = artifacts.require("TicketBroker")

contract("TicketBroker", accounts => {
    let broker
    let fixture

    const sender = accounts[0]
    const recipient = accounts[1]

    const unlockPeriod = 20
    const ticketValidityPeriod = 2

    const currentRound = DUMMY_TICKET_CREATION_ROUND

    before(async () => {
        fixture = new Fixture(web3)
        await fixture.deploy()

        broker = await TicketBroker.new(
            fixture.controller.address,
            unlockPeriod,
            ticketValidityPeriod
        )

        await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
        await fixture.roundsManager.setMockBytes32(
            functionSig("blockHashForRound(uint256)"),
            DUMMY_TICKET_CREATION_ROUND_BLOCK_HASH
        )
    })

    beforeEach(async () => {
        await fixture.setUp()
        await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("fundDeposit", () => {
        it("should fail if the system is paused", async () => {
            await fixture.controller.pause()
            await expectRevertWithReason(broker.fundDeposit({from: sender, value: 1000}), "system is paused")
        })

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

            const deposit = (await broker.getSenderInfo(sender)).sender.deposit.toString()

            assert.equal(deposit, "1000")
        })

        it("tracks sender's multiple deposits", async () => {
            await broker.fundDeposit({from: sender, value: 1000})
            await broker.fundDeposit({from: sender, value: 500})

            const deposit = (await broker.getSenderInfo(sender)).sender.deposit.toString()

            assert.equal(deposit, "1500")
        })

        it("track multiple sender's deposits", async () => {
            const sender2 = accounts[2]
            await broker.fundDeposit({from: sender, value: 1000})
            await broker.fundDeposit({from: sender2, value: 500})

            const deposit = (await broker.getSenderInfo(sender)).sender.deposit.toString()
            const deposit2 = (await broker.getSenderInfo(sender2)).sender.deposit.toString()

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
        it("should fail if the system is paused", async () => {
            await fixture.controller.pause()
            await expectRevertWithReason(broker.fundReserve({from: sender, value: 1000}), "system is paused")
        })

        it("grows the Minter ETH balance", async () => {
            await broker.fundReserve({from: sender, value: 1000})

            const balance = await web3.eth.getBalance(fixture.minter.address)

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

            const reserve = (await broker.getSenderInfo(sender)).reserve.fundsRemaining.toString()

            assert.equal(reserve, "1000")
        })

        it("tracks sender's multiple reserve fundings", async () => {
            await broker.fundReserve({from: sender, value: 1000})
            await broker.fundReserve({from: sender, value: 500})

            const reserve = (await broker.getSenderInfo(sender)).reserve.fundsRemaining.toString()

            assert.equal(reserve, "1500")
        })

        it("track multiple sender's reserves", async () => {
            const sender2 = accounts[2]
            await broker.fundReserve({from: sender, value: 1000})
            await broker.fundReserve({from: sender2, value: 500})

            const reserve = (await broker.getSenderInfo(sender)).reserve.fundsRemaining.toString()
            const reserve2 = (await broker.getSenderInfo(sender2)).reserve.fundsRemaining.toString()

            assert.equal(reserve, "1000")
            assert.equal(reserve2, "500")
        })

        it("preserves remaining funds when reserve was claimed from", async () => {
            const numRecipients = 10
            const reserve = 1000
            const allocation = reserve / numRecipients
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), numRecipients)
            await fixture.bondingManager.setMockBool(functionSig("isActiveTranscoder(address)"), true)
            await broker.fundReserve({from: sender, value: reserve})

            const recipientRand = 5
            const faceValue = 1000
            const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

            // Deposit is 0 so this will claim from the reserve
            await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

            // No additional funds so this should not increase the reserve
            await broker.fundReserve({from: sender})

            const remainingReserve = reserve - allocation
            assert.equal((await broker.getSenderInfo(sender)).reserve.fundsRemaining.toString(), remainingReserve.toString())
        })

        it("preserves remaining funds when reserve was claimed from and adds additional funds", async () => {
            const numRecipients = 10
            const reserve = 1000
            const allocation = reserve / numRecipients
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), numRecipients)
            await fixture.bondingManager.setMockBool(functionSig("isActiveTranscoder(address)"), true)
            await broker.fundReserve({from: sender, value: reserve})

            const recipientRand = 5
            const faceValue = 1000
            const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

            // Deposit is 0 so this will claim from the reserve
            await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

            const additionalFunds = 100
            await broker.fundReserve({from: sender, value: additionalFunds})

            const remainingReserve = reserve - allocation
            assert.equal(
                (await broker.getSenderInfo(sender)).reserve.fundsRemaining.toString(),
                (remainingReserve + additionalFunds).toString()
            )
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
                return ev.reserveHolder === sender && ev.amount.toString() === "1000"
            })
        })

        it("emits a ReserveFunded event with indexed sender", async () => {
            const sender2 = accounts[2]
            const fromBlock = (await web3.eth.getBlock("latest")).number
            await broker.fundReserve({from: sender, value: 1000})
            await broker.fundReserve({from: sender2, value: 1000})

            const events = await broker.getPastEvents("ReserveFunded", {
                filter: {
                    reserveHolder: sender
                },
                fromBlock,
                toBlock: "latest"
            })

            assert.equal(events.length, 1)
            assert.equal(events[0].returnValues.reserveHolder, sender)
            assert.equal(events[0].returnValues.amount.toString(), "1000")
        })
    })

    describe("fundDepositAndReserve", () => {
        it("should fail if the system is paused", async () => {
            const deposit = 500
            const reserve = 1000
            await fixture.controller.pause()
            await expectRevertWithReason(
                broker.fundDepositAndReserve(deposit, reserve, {from: sender, value: 1000}),
                "system is paused"
            )
        })

        it("reverts if msg.value < sum of deposit amount and reserve amount", async () => {
            const deposit = 500
            const reserve = 1000

            await expectRevertWithReason(
                broker.fundDepositAndReserve(
                    deposit,
                    reserve,
                    {from: sender, value: deposit + reserve - 1}
                ),
                "msg.value does not equal sum of deposit amount and reserve amount"
            )
        })

        it("reverts if msg.value > sum of deposit amount and reserve amount", async () => {
            const deposit = 500
            const reserve = 1000

            await expectRevertWithReason(
                broker.fundDepositAndReserve(
                    deposit,
                    reserve,
                    {from: sender, value: deposit + reserve + 1}
                ),
                "msg.value does not equal sum of deposit amount and reserve amount"
            )
        })

        it("grows the Minter's ETH balance by sum of deposit and reserve amounts", async () => {
            const deposit = 500
            const reserve = 1000
            const startMinterBalance = new BN(await web3.eth.getBalance(fixture.minter.address))

            await broker.fundDepositAndReserve(
                deposit,
                reserve,
                {from: sender, value: deposit + reserve}
            )

            const endMinterBalance = new BN(await web3.eth.getBalance(fixture.minter.address))

            assert.equal(endMinterBalance.sub(startMinterBalance).toString(), (deposit + reserve).toString())
        })

        it("reduces the sender's ETH balance by sum of deposit and reserve amounts", async () => {
            const deposit = 500
            const reserve = 1000
            const startSenderBalance = new BN(await web3.eth.getBalance(sender))

            const txResult = await broker.fundDepositAndReserve(
                deposit,
                reserve,
                {from: sender, value: deposit + reserve}
            )

            const endSenderBalance = new BN(await web3.eth.getBalance(sender))
            const txCost = await calcTxCost(txResult)

            assert.equal(startSenderBalance.sub(endSenderBalance).sub(txCost).toString(), (deposit + reserve).toString())
        })

        it("tracks sender's ETH deposit and reserve", async () => {
            const deposit = 500
            const reserve = 1000

            await broker.fundDepositAndReserve(
                deposit,
                reserve,
                {from: sender, value: deposit + reserve}
            )

            const endSenderInfo = await broker.getSenderInfo(sender)
            const endReserve = endSenderInfo.reserve.fundsRemaining

            assert.equal(endSenderInfo.sender.deposit.toString(), deposit.toString())
            assert.equal(endReserve.toString(), reserve.toString())
        })

        it("preserves remaining funds when reserve was claimed from", async () => {
            const numRecipients = 10
            const reserve = 1000
            const allocation = reserve / numRecipients
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), numRecipients)
            await fixture.bondingManager.setMockBool(functionSig("isActiveTranscoder(address)"), true)
            await broker.fundReserve({from: sender, value: reserve})

            const recipientRand = 5
            const faceValue = 1000
            const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

            // Deposit is 0 so this will claim from the reserve
            await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

            // No additional reserve funds so this should not increase reserve 
            await broker.fundDepositAndReserve(
                100,
                0,
                {from: sender, value: 100}
            )

            const remainingReserve = reserve - allocation
            assert.equal((await broker.getSenderInfo(sender)).reserve.fundsRemaining.toString(), remainingReserve.toString())
        })

        it("preserves remaining funds when reserve was claimed from and adds additional funds", async () => {
            const numRecipients = 10
            const reserve = 1000
            const allocation = reserve / numRecipients
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), numRecipients)
            await fixture.bondingManager.setMockBool(functionSig("isActiveTranscoder(address)"), true)
            await broker.fundReserve({from: sender, value: reserve})

            const recipientRand = 5
            const faceValue = 1000
            const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

            // Deposit is 0 so this will claim from the reserve
            await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

            const additionalFunds = 100
            await broker.fundDepositAndReserve(
                100,
                additionalFunds,
                {from: sender, value: 100 + additionalFunds}
            )

            const remainingReserve = reserve - allocation
            assert.equal(
                (await broker.getSenderInfo(sender)).reserve.fundsRemaining.toString(),
                (remainingReserve + additionalFunds).toString()
            )
        })
    })

    describe("redeemWinningTicket", () => {
        it("should fail if the system is paused", async () => {
            const deposit = 1500
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await broker.fundDeposit({from: sender, value: deposit})

            const recipientRand = 5
            const faceValue = deposit
            const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

            await fixture.controller.pause()

            await expectRevertWithReason(
                broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient}),
                "system is paused"
            )
        })

        it("should fail if the current round is not initialized", async () => {
            const deposit = 1500
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await broker.fundDeposit({from: sender, value: deposit})

            const recipientRand = 5
            const faceValue = deposit
            const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), false)

            await expectRevertWithReason(
                broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient}),
                "current round is not initialized"
            )
        })

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

        it("reverts if ticket auxData != 64 bytes", async () => {
            const auxData = web3.utils.toHex(5)

            await expectRevertWithReason(
                broker.redeemWinningTicket(
                    createTicket({
                        recipient,
                        sender,
                        auxData
                    }),
                    web3.utils.asciiToHex("sig"),
                    5
                ),
                "invalid length for ticket auxData: must be 64 bytes"
            )
        })

        it("reverts if block hash for ticket creationRound is null", async () => {
            await fixture.roundsManager.setMockBytes32(
                functionSig("blockHashForRound(uint256)"),
                constants.NULL_BYTES
            )

            await expectRevertWithReason(
                broker.redeemWinningTicket(
                    createTicket({
                        recipient,
                        sender
                    }),
                    web3.utils.asciiToHex("sig"),
                    5
                ),
                "ticket creationRound does not have a block hash"
            )
        })

        it("reverts if ticket creationRoundBlockHash is invalid for ticket creationRound", async () => {
            await fixture.roundsManager.setMockBytes32(
                functionSig("blockHashForRound(uint256)"),
                web3.utils.keccak256("bar")
            )

            await expectRevertWithReason(
                broker.redeemWinningTicket(
                    createTicket({
                        recipient,
                        sender
                    }),
                    web3.utils.asciiToHex("sig"),
                    5
                ),
                "ticket creationRoundBlockHash invalid for creationRound"
            )
        })

        it("reverts if ticket is expired based on ticket creationRound", async () => {
            const expirationRound = currentRound + ticketValidityPeriod
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), expirationRound)

            await expectRevertWithReason(
                broker.redeemWinningTicket(
                    createTicket({
                        recipient,
                        sender
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

        it("reverts if sender is unlocked", async () => {
            // Unlock the sender
            await broker.fundDeposit({from: sender, value: 100})
            await broker.unlock({from: sender})
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + unlockPeriod)

            const recipientRand = 5
            const auxData = createAuxData(currentRound + unlockPeriod, DUMMY_TICKET_CREATION_ROUND_BLOCK_HASH)
            const ticket = createWinningTicket(recipient, sender, recipientRand, 0, auxData)
            const ticketHash = getTicketHash(ticket)
            const senderSig = await web3.eth.sign(ticketHash, sender)

            await expectRevertWithReason(
                broker.redeemWinningTicket(
                    ticket,
                    senderSig,
                    recipientRand
                ),
                "sender is unlocked"
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

        it("reverts if sender's deposit and reserve are zero", async () => {
            const recipientRand = 5
            const ticket = createWinningTicket(recipient, sender, recipientRand)
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

            await expectRevertWithReason(
                broker.redeemWinningTicket(
                    ticket,
                    senderSig,
                    recipientRand
                ),
                "sender deposit and reserve are zero"
            )
        })

        describe("deposit < faceValue", () => {
            describe("sender.deposit is zero", () => {
                it("does not allow a claim if there are no registered recipients", async () => {
                    await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
                    // Set the number of registered recipients to 0
                    await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), 0)
                    await fixture.bondingManager.setMockBool(functionSig("isActiveTranscoder(address)"), false)
                    await broker.fundReserve({from: sender, value: 1000})

                    const recipientRand = 5
                    const faceValue = 10
                    const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                    const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

                    // There are no registered recipients so the recipients should not be able to claim
                    const txRes = await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})
                    truffleAssert.eventEmitted(txRes, "WinningTicketRedeemed")
                    truffleAssert.eventNotEmitted(txRes, "ReserveClaimed")
                    assert.equal((await broker.claimedReserve(sender, recipient)).toString(), "0")
                })

                it("does not allow a claim for an unregistered recipient", async () => {
                    const numRecipients = 10
                    await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
                    await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), numRecipients)
                    await fixture.bondingManager.setMockBool(functionSig("isActiveTranscoder(address)"), false)
                    await broker.fundReserve({from: sender, value: 1000})

                    const recipientRand = 5
                    const faceValue = 10
                    const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                    const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

                    // Recipient is not registered so it should not be able to claim from the reserve
                    const txRes = await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})
                    truffleAssert.eventEmitted(txRes, "WinningTicketRedeemed")
                    truffleAssert.eventNotEmitted(txRes, "ReserveClaimed")
                    assert.equal((await broker.claimedReserve(sender, recipient)).toString(), "0")
                })

                it("does not allow a claim for a registered recipient that has claimed the max allocation", async () => {
                    const numRecipients = 10
                    const reserve = 1000
                    const allocation = reserve / numRecipients
                    await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
                    await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), numRecipients)
                    await fixture.bondingManager.setMockBool(functionSig("isActiveTranscoder(address)"), true)
                    await broker.fundReserve({from: sender, value: reserve})

                    const recipientRand = 5
                    const faceValue = allocation
                    const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                    const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

                    // Claim with faceValue = max allocation
                    await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                    const ticket2 = createWinningTicket(recipient, sender, recipientRand, faceValue)
                    ticket2.senderNonce++
                    const senderSig2 = await web3.eth.sign(getTicketHash(ticket2), sender)

                    // Should not claim anything because recipient has already claimed the max allocation
                    const txRes = await broker.redeemWinningTicket(ticket2, senderSig2, recipientRand, {from: recipient})

                    truffleAssert.eventNotEmitted(txRes, "ReserveClaimed")
                })

                it("allows a partial claim for a registered recipient trying to claim an amount that would exceed the max allocation", async () => {
                    const numRecipients = 10
                    const reserve = 1000
                    const allocation = reserve / numRecipients
                    const partialAmount = 10
                    await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
                    await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), numRecipients)
                    await fixture.bondingManager.setMockBool(functionSig("isActiveTranscoder(address)"), true)
                    await broker.fundReserve({from: sender, value: reserve})

                    const recipientRand = 5
                    const faceValue = allocation - partialAmount
                    const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                    const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

                    // Leave partialAmount unclaimed
                    await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                    const ticket2 = createWinningTicket(recipient, sender, recipientRand, faceValue)
                    ticket2.senderNonce++
                    const senderSig2 = await web3.eth.sign(getTicketHash(ticket2), sender)

                    // Claim the remaining partialAmount
                    const txRes = await broker.redeemWinningTicket(ticket2, senderSig2, recipientRand, {from: recipient})

                    truffleAssert.eventEmitted(txRes, "ReserveClaimed", ev => {
                        return ev.reserveHolder === sender
                            && ev.claimant === recipient
                            && ev.amount.toString() === partialAmount.toString()
                    })
                })

                it("allows a claim from a registered recipient", async () => {
                    const fromBlock = (await web3.eth.getBlock("latest")).number
                    const numRecipients = 10
                    await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
                    await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), numRecipients)
                    await fixture.bondingManager.setMockBool(functionSig("isActiveTranscoder(address)"), true)
                    await broker.fundReserve({from: sender, value: 1000})

                    const recipientRand = 5
                    const faceValue = 10
                    const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                    const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

                    const txRes = await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                    truffleAssert.eventEmitted(txRes, "ReserveClaimed", ev => {
                        return ev.reserveHolder === sender
                            && ev.claimant === recipient
                            && ev.amount.toString() === ticket.faceValue.toString()
                    })
                    assert.equal((await broker.claimedReserve(sender, recipient)).toString(), ticket.faceValue.toString())

                    // Check that fee pool in BondingManager is updated
                    const events = await fixture.bondingManager.getPastEvents("UpdateTranscoderWithFees", {
                        fromBlock,
                        toBlock: "latest"
                    })

                    assert.equal(events.length, 1)
                    const event = events[0]
                    assert.equal(event.returnValues.transcoder, recipient)
                    assert.equal(event.returnValues.fees, faceValue)
                    assert.equal(event.returnValues.round, currentRound)
                })

                it("allows multiple claims from a registered recipient", async () => {
                    const numRecipients = 10
                    await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
                    await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), numRecipients)
                    await fixture.bondingManager.setMockBool(functionSig("isActiveTranscoder(address)"), true)
                    await broker.fundReserve({from: sender, value: 1000})

                    const recipientRand = 5
                    const faceValue = 10
                    const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                    const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

                    await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                    const ticket2 = createWinningTicket(recipient, sender, recipientRand, faceValue + 15)
                    ticket2.senderNonce++
                    const senderSig2 = await web3.eth.sign(getTicketHash(ticket2), sender)

                    const txRes = await broker.redeemWinningTicket(ticket2, senderSig2, recipientRand, {from: recipient})

                    truffleAssert.eventEmitted(txRes, "ReserveClaimed", ev => {
                        return ev.reserveHolder === sender
                            && ev.claimant === recipient
                            && ev.amount.toString() === ticket2.faceValue.toString()
                    })
                    assert.equal((await broker.claimedReserve(sender, recipient)).toString(), (ticket.faceValue + ticket2.faceValue).toString())
                })

                it("allows claims from multiple registered recipients", async () => {
                    const recipient2 = accounts[2]
                    const numRecipients = 10
                    await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
                    await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), numRecipients)
                    await fixture.bondingManager.setMockBool(functionSig("isActiveTranscoder(address)"), true)
                    await broker.fundReserve({from: sender, value: 1000})

                    const recipientRand = 5
                    const faceValue = 10
                    const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                    const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

                    await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                    const ticket2 = createWinningTicket(recipient2, sender, recipientRand, faceValue + 15)
                    const senderSig2 = await web3.eth.sign(getTicketHash(ticket2), sender)

                    const txRes = await broker.redeemWinningTicket(ticket2, senderSig2, recipientRand, {from: recipient2})

                    truffleAssert.eventEmitted(txRes, "ReserveClaimed", ev => {
                        return ev.reserveHolder === sender
                            && ev.claimant === recipient2
                            && ev.amount.toString() === ticket2.faceValue.toString()
                    })
                    assert.equal((await broker.claimedReserve(sender, recipient)).toString(), ticket.faceValue.toString())
                    assert.equal((await broker.claimedReserve(sender, recipient2)).toString(), ticket2.faceValue.toString())
                })

                it("allows claims from all registered recipients for their full reserve allocations", async () => {
                    const recipient2 = accounts[2]
                    const numRecipients = 2
                    const reserve = 1000
                    const allocation = reserve / numRecipients
                    const fromBlock = (await web3.eth.getBlock("latest")).number
                    await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
                    await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), numRecipients)
                    await fixture.bondingManager.setMockBool(functionSig("isActiveTranscoder(address)"), true)
                    await broker.fundReserve({from: sender, value: reserve})

                    const recipientRand = 5
                    const faceValue = allocation * 2
                    const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                    const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

                    await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                    const ticket2 = createWinningTicket(recipient2, sender, recipientRand, faceValue + 15)
                    const senderSig2 = await web3.eth.sign(getTicketHash(ticket2), sender)

                    await broker.redeemWinningTicket(ticket2, senderSig2, recipientRand, {from: recipient2})

                    const events = await broker.getPastEvents("ReserveClaimed", {
                        fromBlock,
                        toBlock: "latest"
                    })

                    assert.equal(events.length, 2)
                    const event = events[0]
                    assert.equal(event.returnValues.reserveHolder, sender)
                    assert.equal(event.returnValues.claimant, recipient)
                    assert.equal(event.returnValues.amount, allocation.toString())
                    const event2 = events[1]
                    assert.equal(event2.returnValues.reserveHolder, sender)
                    assert.equal(event2.returnValues.claimant, recipient2)
                    assert.equal(event2.returnValues.amount, allocation.toString())
                    assert.equal((await broker.getSenderInfo(sender)).reserve.fundsRemaining.toString(), "0")
                    assert.equal((await broker.claimedReserve(sender, recipient)).toString(), allocation.toString())
                    assert.equal((await broker.claimedReserve(sender, recipient2)).toString(), allocation.toString())
                })
            })

            describe("sender.deposit is not zero", () => {
                describe("sender.reserve is zero", () => {
                    it("transfers deposit and updates recipient's fee pool in BondingManager", async () => {
                        const fromBlock = (await web3.eth.getBlock("latest")).number
                        const numRecipients = 10
                        const deposit = 500
                        await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
                        await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), numRecipients)
                        await fixture.bondingManager.setMockBool(functionSig("isActiveTranscoder(address)"), true)
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
                        const endDeposit = (await broker.getSenderInfo(sender)).sender.deposit.toString()
                        assert.equal(endDeposit, "0")
                    })
                })

                describe("sender.reserve is not zero", () => {
                    it("transfers deposit, claims from reserve and updates recipient's fee pool in BondingManager", async () => {
                        const fromBlock = (await web3.eth.getBlock("latest")).number
                        const numRecipients = 10
                        const deposit = 500
                        const reserve = 50000
                        await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
                        await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), numRecipients)
                        await fixture.bondingManager.setMockBool(functionSig("isActiveTranscoder(address)"), true)
                        await broker.fundDeposit({from: sender, value: deposit})
                        await broker.fundReserve({from: sender, value: reserve})

                        const recipientRand = 5
                        // Should be covered by deposit = 500 and reserve allocation = 50000 / 10 = 500
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
                        assert.equal(event.returnValues.fees, ticket.faceValue.toString())
                        assert.equal(event.returnValues.round, currentRound)
                        const endDeposit = (await broker.getSenderInfo(sender)).sender.deposit.toString()
                        assert.equal(endDeposit, "0")
                    })
                })
            })
        })

        it("does not transfer sender.deposit to recipient when faceValue is zero", async () => {
            const deposit = 1500
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await broker.fundDeposit({from: sender, value: deposit})

            const recipientRand = 5
            const ticket = createWinningTicket(recipient, sender, recipientRand)
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

            // Redeem with ticket faceValue = 0
            const txRes = await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

            truffleAssert.eventNotEmitted(txRes, "WinningTicketTransfer")
            truffleAssert.eventNotEmitted(txRes, "UpdateTranscoderWithFees")
            const endDeposit = (await broker.getSenderInfo(sender)).sender.deposit.toString()
            assert.equal(endDeposit, deposit)
        })

        it("updates recipient's fee pool in BondingManager with faceValue when deposit = faceValue", async () => {
            const fromBlock = (await web3.eth.getBlock("latest")).number
            const deposit = 1500
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await broker.fundDeposit({from: sender, value: deposit})

            const recipientRand = 5
            const faceValue = deposit
            const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

            // Redeem with ticket faceValue = deposit
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
            const endDeposit = (await broker.getSenderInfo(sender)).sender.deposit.toString()
            assert.equal(endDeposit, "0")
        })

        it("updates recipient's fee pool in BondingManager with faceValue when deposit > faceValue", async () => {
            const fromBlock = (await web3.eth.getBlock("latest")).number
            const deposit = 1500
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await broker.fundDeposit({from: sender, value: deposit})

            const recipientRand = 5
            const faceValue = deposit - 100
            const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

            // Redeem with ticket faceValue < deposit
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
            const endDeposit = (await broker.getSenderInfo(sender)).sender.deposit.toString()
            assert.equal(endDeposit, (deposit - faceValue).toString())
        })

        it("can be called by an account that is not the recipient", async () => {
            const thirdParty = accounts[2]
            const deposit = 1500
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await broker.fundDeposit({from: sender, value: deposit})

            const recipientRand = 5
            const faceValue = 1000
            const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

            // Third party redeems the ticket
            await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: thirdParty})

            const endDeposit = (await broker.getSenderInfo(sender)).sender.deposit.toString()
            assert.equal(endDeposit, (deposit - faceValue).toString())
        })

        it("emits a WinningTicketRedeemed event", async () => {
            const deposit = 1500
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
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
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
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
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
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

    describe("batchRedeemWinningTickets", () => {
        it("should fail if the system is paused", async () => {
            const deposit = 1500
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await broker.fundDeposit({from: sender, value: deposit})

            const recipientRand = 5
            const faceValue = 500
            const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
            const ticket2 = createWinningTicket(recipient, sender, recipientRand, faceValue)
            ticket2.senderNonce++
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)
            const senderSig2 = await web3.eth.sign(getTicketHash(ticket2), sender)

            await fixture.controller.pause()

            await expectRevertWithReason(
                broker.batchRedeemWinningTickets(
                    [ticket, ticket2],
                    [senderSig, senderSig2],
                    [recipientRand, recipientRand],
                    {from: recipient}
                ),
                "system is paused"
            )
        })

        it("should fail if the current round is not initialized", async () => {
            const deposit = 1500
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await broker.fundDeposit({from: sender, value: deposit})

            const recipientRand = 5
            const faceValue = 500
            const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
            const ticket2 = createWinningTicket(recipient, sender, recipientRand, faceValue)
            ticket2.senderNonce++
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)
            const senderSig2 = await web3.eth.sign(getTicketHash(ticket2), sender)

            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), false)

            await expectRevertWithReason(
                broker.batchRedeemWinningTickets(
                    [ticket, ticket2],
                    [senderSig, senderSig2],
                    [recipientRand, recipientRand],
                    {from: recipient}
                ),
                "current round is not initialized"
            )
        })

        it("redeems 2 tickets from the same sender", async () => {
            const deposit = 1500
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await broker.fundDeposit({from: sender, value: deposit})

            const fromBlock = (await web3.eth.getBlock("latest")).number
            const recipientRand = 5
            const faceValue = 500
            const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
            const ticket2 = createWinningTicket(recipient, sender, recipientRand, faceValue)
            ticket2.senderNonce++
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)
            const senderSig2 = await web3.eth.sign(getTicketHash(ticket2), sender)

            await broker.batchRedeemWinningTickets(
                [ticket, ticket2],
                [senderSig, senderSig2],
                [recipientRand, recipientRand],
                {from: recipient}
            )

            const events = await broker.getPastEvents("WinningTicketRedeemed", {
                filter: {
                    recipient
                },
                fromBlock,
                toBlock: "latest"
            })

            assert.equal(events.length, 2)
        })

        it("redeems 2 tickets from different senders", async () => {
            const sender2 = accounts[2]
            const deposit = 1500
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await broker.fundDeposit({from: sender, value: deposit})
            await broker.fundDeposit({from: sender2, value: deposit})

            const fromBlock = (await web3.eth.getBlock("latest")).number
            const recipientRand = 5
            const faceValue = 500
            const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
            const ticket2 = createWinningTicket(recipient, sender2, recipientRand, faceValue)
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)
            const senderSig2 = await web3.eth.sign(getTicketHash(ticket2), sender2)

            await broker.batchRedeemWinningTickets(
                [ticket, ticket2],
                [senderSig, senderSig2],
                [recipientRand, recipientRand],
                {from: recipient}
            )

            const sender1Events = await broker.getPastEvents("WinningTicketRedeemed", {
                filter: {
                    sender,
                    recipient
                },
                fromBlock,
                toBlock: "latest"
            })

            assert.equal(sender1Events.length, 1)

            const sender2Events = await broker.getPastEvents("WinningTicketRedeemed", {
                filter: {
                    sender: sender2,
                    recipient
                },
                fromBlock,
                toBlock: "latest"
            })

            assert.equal(sender2Events.length, 1)
        })

        it("redeems 2 tickets with 1 failure", async () => {
            const deposit = 1500
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await broker.fundDeposit({from: sender, value: deposit})

            const fromBlock = (await web3.eth.getBlock("latest")).number
            const recipientRand = 5
            const faceValue = 500
            const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
            const ticket2 = createWinningTicket(constants.NULL_ADDRESS, sender, recipientRand, faceValue)
            ticket2.senderNonce++
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)
            const senderSig2 = await web3.eth.sign(getTicketHash(ticket2), sender)

            await broker.batchRedeemWinningTickets(
                [ticket, ticket2],
                [senderSig, senderSig2],
                [recipientRand, recipientRand],
                {from: recipient}
            )

            const events = await broker.getPastEvents("WinningTicketRedeemed", {
                filter: {
                    recipient
                },
                fromBlock,
                toBlock: "latest"
            })

            assert.equal(events.length, 1)
            // The ticket with a valid recipient should be the only one redeemed
            assert.equal(events[0].returnValues.recipient, recipient)
        })

        it("redeems 2 tickets with 1 failure because the 2nd ticket is a replay of the 1st", async () => {
            const deposit = 1500
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await broker.fundDeposit({from: sender, value: deposit})

            const fromBlock = (await web3.eth.getBlock("latest")).number
            const recipientRand = 5
            const faceValue = 500
            const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

            await broker.batchRedeemWinningTickets(
                [ticket, ticket],
                [senderSig, senderSig],
                [recipientRand, recipientRand],
                {from: recipient}
            )

            const events = await broker.getPastEvents("WinningTicketRedeemed", {
                filter: {
                    recipient
                },
                fromBlock,
                toBlock: "latest"
            })

            // There should have been only one ticket redeemed because the second one is a replay
            assert.equal(events.length, 1)
        })

        it("redeems 2 tickets with 2 failures", async () => {
            const deposit = 1500
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await broker.fundDeposit({from: sender, value: deposit})

            const fromBlock = (await web3.eth.getBlock("latest")).number
            const recipientRand = 5
            const faceValue = 500
            const ticket = createWinningTicket(constants.NULL_ADDRESS, sender, recipientRand, faceValue)
            const ticket2 = createWinningTicket(constants.NULL_ADDRESS, sender, recipientRand, faceValue)
            ticket2.senderNonce++
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)
            const senderSig2 = await web3.eth.sign(getTicketHash(ticket2), sender)

            await broker.batchRedeemWinningTickets(
                [ticket, ticket2],
                [senderSig, senderSig2],
                [recipientRand, recipientRand],
                {from: recipient}
            )

            const events = await broker.getPastEvents("WinningTicketRedeemed", {
                filter: {
                    recipient
                },
                fromBlock,
                toBlock: "latest"
            })

            assert.equal(events.length, 0)
        })
    })

    describe("unlock", () => {
        it("fails if the system is paused", async () => {
            await broker.fundDeposit({from: sender, value: 1000})
            await fixture.controller.pause()
            await expectRevertWithReason(broker.unlock(), "system is paused")
        })

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

        it("sets withdrawRound according to constructor config", async () => {
            await broker.fundDeposit({from: sender, value: 1000})

            await broker.unlock({from: sender})

            const expectedWithdrawRound = currentRound + unlockPeriod
            const withdrawRound = (await broker.getSenderInfo(sender)).sender.withdrawRound.toString()
            assert.equal(withdrawRound, expectedWithdrawRound.toString())
        })

        it("sets isUnlockInProgress to true", async () => {
            await broker.fundDeposit({from: sender, value: 1000})

            await broker.unlock({from: sender})

            const isUnlockInProgress = await broker.isUnlockInProgress.call(sender)
            assert(isUnlockInProgress)
        })

        it("emits an Unlock event", async () => {
            await broker.fundDeposit({from: sender, value: 1000})
            const expectedStartRound = currentRound
            const expectedEndRound = expectedStartRound + unlockPeriod

            const txResult = await broker.unlock({from: sender})

            truffleAssert.eventEmitted(txResult, "Unlock", ev => {
                return ev.sender === sender &&
                    ev.startRound.toString() === expectedStartRound.toString() &&
                    ev.endRound.toString() === expectedEndRound.toString()
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
        it("fails if the system is paused", async () => {
            await broker.fundDeposit({from: sender, value: 1000})
            await broker.unlock()
            await fixture.controller.pause()
            await expectRevertWithReason(broker.cancelUnlock(), "system is paused")
        })

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
        it("fails if the system is paused", async () => {
            await broker.fundDeposit({value: 1000})
            await broker.unlock()
            await fixture.rpc.wait(unlockPeriod)
            await fixture.controller.pause()
            await expectRevertWithReason(broker.withdraw(), "system is paused")
        })

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
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + unlockPeriod)

            await broker.withdraw({from: sender})

            const senderInfo = await broker.getSenderInfo(sender)
            const deposit = senderInfo.sender.deposit
            const reserve = senderInfo.reserve.fundsRemaining
            assert.equal(deposit, "0")
            assert.equal(reserve, "0")
        })

        it("transfers the sum of deposit and reserve to sender", async () => {
            const fromBlock = (await web3.eth.getBlock("latest")).number
            const deposit = 1000
            const reserve = 2000
            await broker.fundDeposit({from: sender, value: deposit})
            await broker.fundReserve({from: sender, value: reserve})
            await broker.unlock({from: sender})
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + unlockPeriod)

            await broker.withdraw({from: sender})

            const events = await fixture.minter.getPastEvents("TrustedWithdrawETH", {
                fromBlock,
                toBlock: "latest"
            })

            assert.equal(events.length, 1)
            const event = events[0]
            assert.equal(event.returnValues.to, sender)
            assert.equal(event.returnValues.amount.toString(), (deposit + reserve).toString())
        })

        it("completes withdrawal when deposit == 0", async () => {
            const fromBlock = (await web3.eth.getBlock("latest")).number
            const reserve = 2000
            await broker.fundReserve({from: sender, value: reserve})
            await broker.unlock({from: sender})
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + unlockPeriod)

            await broker.withdraw({from: sender})

            const events = await fixture.minter.getPastEvents("TrustedWithdrawETH", {
                fromBlock,
                toBlock: "latest"
            })

            assert.equal(events.length, 1)
            const event = events[0]
            assert.equal(event.returnValues.to, sender)
            assert.equal(event.returnValues.amount.toString(), reserve.toString())
        })

        it("completes withdrawal when reserve == 0", async () => {
            const fromBlock = (await web3.eth.getBlock("latest")).number
            const deposit = 1000
            await broker.fundDeposit({from: sender, value: deposit})
            await broker.unlock({from: sender})
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + unlockPeriod)

            await broker.withdraw({from: sender})

            const events = await fixture.minter.getPastEvents("TrustedWithdrawETH", {
                fromBlock,
                toBlock: "latest"
            })

            assert.equal(events.length, 1)
            const event = events[0]
            assert.equal(event.returnValues.to, sender)
            assert.equal(event.returnValues.amount.toString(), deposit.toString())
        })

        it("emits a Withdrawal event", async () => {
            const deposit = 1000
            const reserve = 2000
            await broker.fundDeposit({from: sender, value: deposit})
            await broker.fundReserve({from: sender, value: reserve})
            await broker.unlock({from: sender})
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + unlockPeriod)

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
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + unlockPeriod)

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

    describe("claimableReserve", () => {
        it("returns 0 when the reserveHolder does not have a reserve", async () => {
            const numRecipients = 10
            await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), numRecipients)
            assert.equal((await broker.claimableReserve(constants.NULL_ADDRESS, constants.NULL_ADDRESS)).toString(10), "0")
        })

        it("returns 0 if claimant is not active in the current round", async () => {
            const reserve = 1000
            await broker.fundReserve({from: sender, value: reserve})
            assert.equal((await broker.claimableReserve(sender, constants.NULL_ADDRESS)).toString(10), "0")
        })

        it("returns 0 when the active transcoder pool size is 0", async () => {
            await fixture.bondingManager.setMockBool(functionSig("isActiveTranscoder(address)"), true)
            await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), 0)

            const reserve = 1000
            await broker.fundReserve({from: sender, value: reserve})
            assert.equal((await broker.claimableReserve(sender, constants.NULL_ADDRESS)).toString(10), "0")
        })

        it("returns claimable reserve for a claimaint if reserve was not claimed from", async () => {
            const numRecipients = 10
            const deposit = 1000
            const reserve = 1000
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), numRecipients)
            await fixture.bondingManager.setMockBool(functionSig("isActiveTranscoder(address)"), true)
            await broker.fundDepositAndReserve(deposit, reserve, {from: sender, value: deposit+reserve})
            assert.equal(
                (await broker.claimableReserve(sender, recipient)).toString(10),
                (reserve/numRecipients).toString(10)
            )
            const recipientRand = 5
            const faceValue = 10
            const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)
            // Redeem a winning ticket
            await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})
            // Reserve allocated for recipient should still be 100 since ticket was drawn from deposit 
            assert.equal(
                (await broker.claimableReserve(sender, recipient)).toString(10),
                "100"
            )
            // Ticket faceValue should be substracted from deposit
            assert.equal(
                (deposit-faceValue).toString(10),
                (await broker.getSenderInfo(sender)).sender.deposit.toString(10)
            )
        })

        it("returns claimable reserve for a claimant when reserve was claimed from", async () => {
            const numRecipients = 10
            const reserve = 1000
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), numRecipients)
            await fixture.bondingManager.setMockBool(functionSig("isActiveTranscoder(address)"), true)
            await broker.fundReserve({from: sender, value: reserve})

            const recipientRand = 5
            const faceValue = 10
            const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
            const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)
            // Claim winning ticket - will claim from reserve (deposit = 0)
            await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})
            // claimableReserve should be equal to reserve/numRecipients - faceValue
            assert.equal(
                (await broker.claimableReserve(sender, recipient)).toString(10),
                (reserve/numRecipients - faceValue).toString(10)
            )
        })

        it("returns 0 if claimant has claimed all of his claimableReserve", async () => {
            const numRecipients = 10
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), numRecipients)
            await fixture.bondingManager.setMockBool(functionSig("isActiveTranscoder(address)"), true)
            await broker.fundReserve({from: sender, value: 1000})

            let recipientRand = 5
            const faceValue = 100
            let ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
            let senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

            // Claim winning ticket - will freeze reserve (deposit = 0)
            await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})
            assert.equal(
                (await broker.claimableReserve(sender, recipient)).toString(10),
                "0"
            )
        })
    })
})
