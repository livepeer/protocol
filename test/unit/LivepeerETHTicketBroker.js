import BN from "bn.js"
import Fixture from "./helpers/Fixture"
import expectThrow from "../helpers/expectThrow"
import {wrapRedeemWinningTicket, createWinningTicket, getTicketHash} from "../helpers/ticket"
import {functionSig} from "../../utils/helpers"

const TicketBroker = artifacts.require("LivepeerETHTicketBroker")

contract("LivepeerETHTicketBroker", accounts => {
    let fixture
    let broker
    let redeemWinningTicket

    const sender = accounts[0]
    const recipient = accounts[1]

    const unlockPeriod = 20
    const signerRevocationPeriod = 20

    before(async () => {
        fixture = new Fixture(web3)
        await fixture.deploy()

        broker = await TicketBroker.new(fixture.controller.address, unlockPeriod, signerRevocationPeriod)

        redeemWinningTicket = wrapRedeemWinningTicket(broker)
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

    describe("fundReserve", () => {
        it("grows the Minter ETH balance", async () => {
            await broker.fundReserve({from: sender, value: 1000})

            const balance = await web3.eth.getBalance(fixture.minter.address)

            assert.equal(balance, "1000")
        })
    })

    describe("fundAndApproveSigners", () => {
        const signers = accounts.slice(2, 4)

        it("grows the Minter's ETH balance by sum of deposit and reserve amounts", async () => {
            const deposit = 500
            const reserve = 1000
            const startMinterBalance = new BN(await web3.eth.getBalance(fixture.minter.address))

            await broker.fundAndApproveSigners(
                deposit,
                reserve,
                signers,
                {from: sender, value: deposit + reserve}
            )

            const endMinterBalance = new BN(await web3.eth.getBalance(fixture.minter.address))

            assert.equal(endMinterBalance.sub(startMinterBalance).toString(), (deposit + reserve).toString())
        })
    })

    describe("redeemWinningTicket", () => {
        describe("winningTicketTransfer", () => {
            describe("deposit < faceValue", () => {
                it("updates transcoder with fees on bonding manager with deposit when reserve = 0", async () => {
                    const currentRound = 17
                    await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
                    const fromBlock = (await web3.eth.getBlock("latest")).number
                    const deposit = 500
                    await broker.fundDeposit({from: sender, value: deposit})

                    const recipientRand = 5
                    const faceValue = 1000
                    const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                    const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

                    await redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

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

                it("updates transcoder with fees on bonding manager with deposit and claimed reserve funds when reserve > 0", async () => {
                    const currentRound = 17
                    const numRecipients = 10
                    await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
                    await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), numRecipients)
                    await fixture.bondingManager.setMockBool(functionSig("isRegisteredTranscoder(address)"), true)
                    const fromBlock = (await web3.eth.getBlock("latest")).number
                    const deposit = 500
                    const reserve = 50000
                    await broker.fundDeposit({from: sender, value: deposit})
                    await broker.fundReserve({from: sender, value: reserve})

                    const recipientRand = 5
                    // Should be covered by deposit = 500 and reserve allocation = 50000 / 10 = 500
                    const faceValue = 1000
                    const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                    const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

                    await redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                    const events = await fixture.bondingManager.getPastEvents("UpdateTranscoderWithFees", {
                        fromBlock,
                        toBlock: "latest"
                    })

                    assert.equal(events.length, 1)
                    const event = events[0]
                    assert.equal(event.returnValues.transcoder, recipient)
                    assert.equal(event.returnValues.fees, ticket.faceValue.toString())
                    assert.equal(event.returnValues.round, currentRound)
                })
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

                await redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

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

                await redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

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

        describe("claimFromReserve", () => {
            describe("reserve is not frozen", () => {
                it("freezes reserve", async () => {
                    const currentRound = 10
                    const numRecipients = 10
                    await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
                    await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), numRecipients)
                    await broker.fundReserve({from: sender, value: 1000})

                    const recipientRand = 5
                    const faceValue = 1000
                    const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                    const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

                    await redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                    const reserve = await broker.getReserve(sender)
                    assert.equal(reserve.freezeRound.toString(), currentRound.toString())
                    assert.equal(reserve.recipientsInFreezeRound.toString(), numRecipients.toString())
                })

                it("emits a ReserveFrozen event", async () => {
                    const currentRound = 10
                    const numRecipients = 10
                    const reserve = 1000
                    const fromBlock = (await web3.eth.getBlock("latest")).number
                    await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
                    await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), numRecipients)
                    await broker.fundReserve({from: sender, value: reserve})

                    const recipientRand = 5
                    const faceValue = 1000
                    const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                    const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

                    await redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                    const events = await broker.getPastEvents("ReserveFrozen", {
                        fromBlock,
                        toBlock: "latest"
                    })

                    assert.equal(events.length, 1)
                    const event = events[0]
                    assert.equal(event.returnValues.sender, sender)
                    assert.equal(event.returnValues.recipient, recipient)
                    assert.equal(event.returnValues.freezeRound.toString(), currentRound.toString())
                    assert.equal(event.returnValues.recipientsInFreezeRound.toString(), numRecipients.toString())
                    assert.equal(event.returnValues.reserveFunds.toString(), reserve.toString())
                })
            })

            describe("reserve is frozen", () => {
                it("does not allow a claim for an unregistered recipient", async () => {
                    const currentRound = 10
                    const numRecipients = 10
                    const fromBlock = (await web3.eth.getBlock("latest")).number
                    await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
                    await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), numRecipients)
                    await fixture.bondingManager.setMockBool(functionSig("isRegisteredTranscoder(address)"), false)
                    await broker.fundReserve({from: sender, value: 1000})

                    const recipientRand = 5
                    const faceValue = 10
                    const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                    const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

                    await redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                    const redeemEvents = await broker.getPastEvents("WinningTicketRedeemed", {
                        fromBlock,
                        toBlock: "latest"
                    })

                    assert.equal(redeemEvents.length, 1)

                    const reserveEvents = await broker.getPastEvents("ReserveClaimed", {
                        fromBlock,
                        toBlock: "latest"
                    })

                    assert.equal(reserveEvents.length, 0)
                })

                it("allows a claim from a registered recipient", async () => {
                    const currentRound = 10
                    const numRecipients = 10
                    const fromBlock = (await web3.eth.getBlock("latest")).number
                    await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
                    await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), numRecipients)
                    await fixture.bondingManager.setMockBool(functionSig("isRegisteredTranscoder(address)"), true)
                    await broker.fundReserve({from: sender, value: 1000})

                    const recipientRand = 5
                    const faceValue = 10
                    const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                    const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

                    await redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                    const events = await broker.getPastEvents("ReserveClaimed", {
                        fromBlock,
                        toBlock: "latest"
                    })

                    assert.equal(events.length, 1)
                    const event = events[0]
                    assert.equal(event.returnValues.sender, sender)
                    assert.equal(event.returnValues.recipient, recipient)
                    assert.equal(event.returnValues.amount, ticket.faceValue.toString())
                })

                it("allows multiple claims from a registered recipient", async () => {
                    const currentRound = 10
                    const numRecipients = 10
                    const fromBlock = (await web3.eth.getBlock("latest")).number
                    await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
                    await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), numRecipients)
                    await fixture.bondingManager.setMockBool(functionSig("isRegisteredTranscoder(address)"), true)
                    await broker.fundReserve({from: sender, value: 1000})

                    const recipientRand = 5
                    const faceValue = 10
                    const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                    const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

                    await redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                    const ticket2 = createWinningTicket(recipient, sender, recipientRand, faceValue + 15)
                    ticket2.senderNonce++
                    const senderSig2 = await web3.eth.sign(getTicketHash(ticket2), sender)

                    await redeemWinningTicket(ticket2, senderSig2, recipientRand, {from: recipient})

                    const events = await broker.getPastEvents("ReserveClaimed", {
                        fromBlock,
                        toBlock: "latest"
                    })

                    assert.equal(events.length, 2)
                    // Check the event for the second redemption
                    const event = events[1]
                    assert.equal(event.returnValues.sender, sender)
                    assert.equal(event.returnValues.recipient, recipient)
                    assert.equal(event.returnValues.amount, ticket2.faceValue.toString())
                })

                it("allows claims from multiple registered recipients", async () => {
                    const recipient2 = accounts[2]
                    const currentRound = 10
                    const numRecipients = 10
                    const fromBlock = (await web3.eth.getBlock("latest")).number
                    await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
                    await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), numRecipients)
                    await fixture.bondingManager.setMockBool(functionSig("isRegisteredTranscoder(address)"), true)
                    await broker.fundReserve({from: sender, value: 1000})

                    const recipientRand = 5
                    const faceValue = 10
                    const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                    const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

                    await redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                    const ticket2 = createWinningTicket(recipient2, sender, recipientRand, faceValue + 15)
                    const senderSig2 = await web3.eth.sign(getTicketHash(ticket2), sender)

                    await redeemWinningTicket(ticket2, senderSig2, recipientRand, {from: recipient2})

                    const events = await broker.getPastEvents("ReserveClaimed", {
                        fromBlock,
                        toBlock: "latest"
                    })

                    assert.equal(events.length, 2)
                    // Check the event for the second redemption
                    const event = events[1]
                    assert.equal(event.returnValues.sender, sender)
                    assert.equal(event.returnValues.recipient, recipient2)
                    assert.equal(event.returnValues.amount, ticket2.faceValue.toString())
                })

                it("allows claims from all registered recipients for their full reserve allocations", async () => {
                    const recipient2 = accounts[2]
                    const currentRound = 10
                    const numRecipients = 2
                    const reserve = 1000
                    const allocation = reserve / numRecipients
                    const fromBlock = (await web3.eth.getBlock("latest")).number
                    await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
                    await fixture.bondingManager.setMockUint256(functionSig("getTranscoderPoolSize()"), numRecipients)
                    await fixture.bondingManager.setMockBool(functionSig("isRegisteredTranscoder(address)"), true)
                    await broker.fundReserve({from: sender, value: 1000})

                    const recipientRand = 5
                    const faceValue = allocation * 2
                    const ticket = createWinningTicket(recipient, sender, recipientRand, faceValue)
                    const senderSig = await web3.eth.sign(getTicketHash(ticket), sender)

                    await redeemWinningTicket(ticket, senderSig, recipientRand, {from: recipient})

                    const ticket2 = createWinningTicket(recipient2, sender, recipientRand, faceValue + 15)
                    const senderSig2 = await web3.eth.sign(getTicketHash(ticket2), sender)

                    await redeemWinningTicket(ticket2, senderSig2, recipientRand, {from: recipient2})

                    const events = await broker.getPastEvents("ReserveClaimed", {
                        fromBlock,
                        toBlock: "latest"
                    })

                    assert.equal(events.length, 2)
                    const event = events[0]
                    assert.equal(event.returnValues.sender, sender)
                    assert.equal(event.returnValues.recipient, recipient)
                    assert.equal(event.returnValues.amount, allocation.toString())
                    const event2 = events[1]
                    assert.equal(event2.returnValues.sender, sender)
                    assert.equal(event2.returnValues.recipient, recipient2)
                    assert.equal(event2.returnValues.amount, allocation.toString())
                })
            })
        })
    })

    describe("withdraw", () => {
        describe("withdrawTransfer", () => {
            it("transfers the sum of deposit and reserve to sender", async () => {
                const fromBlock = (await web3.eth.getBlock("latest")).number
                const deposit = 1000
                const reserve = 2000
                await broker.fundDeposit({from: sender, value: deposit})
                await broker.fundReserve({from: sender, value: reserve})
                await broker.unlock({from: sender})
                await fixture.rpc.wait(unlockPeriod)

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
        })
    })

    describe("setSignerRevocationPeriod", () => {
        it("reverts when called by an account that is not the Controller owner", async () => {
            await expectThrow(broker.setSignerRevocationPeriod(1234, {from: accounts[5]}))
        })

        it("works when called by Controller owner", async () => {
            const expectedPeriod = signerRevocationPeriod + 12
            await broker.setSignerRevocationPeriod(expectedPeriod, {from: accounts[0]})

            const actualPeriod = await broker.signerRevocationPeriod.call()

            assert.equal(actualPeriod.toString(), expectedPeriod.toString())
        })
    })
})
