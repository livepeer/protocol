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
