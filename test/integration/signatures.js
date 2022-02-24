import {constants} from "../../utils/constants"
import {createWinningTicket, getTicketHash} from "../helpers/ticket"
import signMsg, {
    flipV,
    getEIP2098V,
    getLongSigV,
    to2098Format
} from "../helpers/signMsg"

import chai, {expect} from "chai"
import {solidity} from "ethereum-waffle"
import {ethers} from "hardhat"
import setupIntegrationTest from "../helpers/setupIntegrationTest"

chai.use(solidity)

// TODO: move to separate util
export const resetNetwork = async () => {
    await hre.network.provider.request({
        method: "hardhat_reset",
        params: []
    })
}

/**
 * Ensures that PoC exploit introduced in #49163e560ef28b7cbb8c86d233b55618ad29a756 is not viable anymore (the current patch allows the TicketBroker to accept only  signatures with length == 65 bytes)
 *
 */

describe("Signatures tests", () => {
    const recipientRand = 5
    const faceValue = 1000
    const deposit = ethers.utils.parseEther("1")
    const reserve = ethers.utils.parseEther("1")

    // accounts
    let transcoder
    let broadcaster

    // contracts
    let controller
    let broker
    let bondingManager
    let roundsManager
    let minter
    let token

    let roundLength
    let ticket

    const blockNumber = 0

    beforeEach(async () => {
        ;[transcoder, broadcaster] = await ethers.getSigners()

        const fixture = await setupIntegrationTest()

        broker = await ethers.getContractAt(
            "TicketBroker",
            fixture.TicketBroker.address
        )

        controller = await ethers.getContractAt(
            "Controller",
            fixture.Controller.address
        )
        await controller.unpause()

        bondingManager = await ethers.getContractAt(
            "BondingManager",
            fixture.BondingManager.address
        )
        roundsManager = await ethers.getContractAt(
            "AdjustableRoundsManager",
            fixture.AdjustableRoundsManager.address
        )
        token = await ethers.getContractAt(
            "LivepeerToken",
            fixture.LivepeerToken.address
        )
        minter = await ethers.getContractAt("Minter", fixture.Minter.address)

        const amount = ethers.BigNumber.from(10).mul(
            constants.TOKEN_UNIT.toString()
        )
        await token.connect(transcoder).transfer(transcoder.address, amount)

        // Register transcoder
        await token.connect(transcoder).approve(bondingManager.address, amount)
        await bondingManager
            .connect(transcoder)
            .bond(amount, transcoder.address)
        await bondingManager.connect(transcoder).transcoder(0, 0)

        roundLength = await roundsManager.roundLength()
        await roundsManager.mineBlocks(roundLength.mul(1000))
        await roundsManager.setBlockHash(
            ethers.utils.solidityKeccak256(["string"], ["foo"])
        )
        await roundsManager.initializeRound()

        // fund deposit/reserves
        await broker.connect(broadcaster).fundDeposit({value: deposit})
        await broker.connect(broadcaster).fundReserve({value: reserve})
        expect(
            await ethers.provider.getBalance(minter.address),
            "wrong broadcaster balance"
        ).to.equal(deposit.add(reserve))

        // create ticket
        const block = await roundsManager.blockNum()
        const creationRound = await roundsManager.currentRound()
        const creationRoundBlockHash = await roundsManager.blockHash(block)
        const auxData = ethers.utils.solidityPack(
            ["uint256", "bytes32"],
            [creationRound, creationRoundBlockHash]
        )
        ticket = createWinningTicket(
            transcoder.address,
            broadcaster.address,
            recipientRand,
            faceValue,
            auxData
        )

        const updatedBlockNumber = await ethers.provider.getBlockNumber()
        if (blockNumber !== 0) {
            // check to ensure that resetting the network after each test leads to the same block number
            expect(blockNumber, "different block-number scenario").to.be.eq(
                updatedBlockNumber
            )
        }
        blockNumber = updatedBlockNumber
    })

    afterEach(async () => {
        await resetNetwork()
    })

    it("under the max `winProb` value, a ticket has two signature formats that are both eligible to win the lottery, but TicketBroker only accepts legacy long signatures", async () => {
        const BrokerMock = await ethers.getContractFactory(
            "TickerBrokerExtendedMock"
        )
        const brokerMock = await BrokerMock.deploy(controller.address)
        await brokerMock.deployed()
        const longSignature = await signMsg(
            getTicketHash(ticket),
            ticket.sender
        )
        const eip2098Signature = await to2098Format(longSignature)

        const hasLongSignatureWon =
            await brokerMock.validateAndCheckTicketOutcome(
                ticket.sender,
                getTicketHash(ticket),
                longSignature,
                recipientRand,
                ticket.winProb
            )
        const longSignatureToNumber = await brokerMock.checkResult(
            longSignature,
            recipientRand
        )

        await expect(
            brokerMock.validateAndCheckTicketOutcome(
                ticket.sender,
                getTicketHash(ticket),
                eip2098Signature,
                recipientRand,
                ticket.winProb
            )
        ).to.be.revertedWith("eip2098 not allowed")

        const eip2098SignatureToNumber = await brokerMock.checkResult(
            eip2098Signature,
            recipientRand
        )

        expect(longSignature, "signatures are identical").to.not.be.eq(
            eip2098Signature
        )
        expect(
            longSignatureToNumber,
            "signature-generated pseudorandom numbers are identical"
        ).to.not.be.eq(eip2098SignatureToNumber)
        expect(hasLongSignatureWon, "long signature not eligible").to.be.true
            .true

        // / flipping v value
        const flippedLongSignature = flipV(longSignature)
        const flippedEIP2098Signature = to2098Format(flippedLongSignature)

        expect(
            getLongSigV(flippedLongSignature),
            "wrong long v value"
        ).to.be.eq(getLongSigV(longSignature) === 27 ? 28 : 27)
        expect(
            getEIP2098V(flippedEIP2098Signature),
            "wrong eip2098 v value"
        ).to.be.eq(getEIP2098V(eip2098Signature) === 27 ? 28 : 27)

        await expect(
            brokerMock.validateAndCheckTicketOutcome(
                ticket.sender,
                getTicketHash(ticket),
                flippedEIP2098Signature,
                recipientRand,
                ticket.winProb
            )
        ).to.be.revertedWith("eip2098 not allowed")

        await expect(
            brokerMock.validateAndCheckTicketOutcome(
                ticket.sender,
                getTicketHash(ticket),
                flippedLongSignature,
                recipientRand,
                ticket.winProb
            )
        ).to.be.revertedWith("invalid signature over ticket hash")
    })

    it("redeeming a ticket with an eip-2098 signature should always result in failure", async () => {
        const deposit = (await broker.getSenderInfo(broadcaster.address)).sender
            .deposit

        const senderSig = await signMsg(
            getTicketHash(ticket),
            broadcaster.address
        )

        const sig2098 = await to2098Format(senderSig)

        await broker
            .connect(transcoder)
            .redeemWinningTicket(ticket, senderSig, recipientRand)

        await expect(
            broker
                .connect(transcoder)
                .redeemWinningTicket(ticket, sig2098, recipientRand)
        ).to.be.revertedWith("ticket is used")

        const endDeposit = (await broker.getSenderInfo(broadcaster.address))
            .sender.deposit

        expect(endDeposit, "wrong endDeposit").to.equal(
            deposit.sub(ticket.faceValue)
        )

        const round = await roundsManager.currentRound()

        expect(
            await bondingManager.pendingFees(transcoder.address, round)
        ).to.equal(faceValue)
    })

    it("redeeming a ticket with an eip-2098 signature should always result in failure", async () => {
        const deposit = (await broker.getSenderInfo(broadcaster.address)).sender
            .deposit

        const senderSig = await signMsg(
            getTicketHash(ticket),
            broadcaster.address
        )

        const sig2098 = await to2098Format(senderSig)

        await expect(
            broker
                .connect(transcoder)
                .redeemWinningTicket(ticket, sig2098, recipientRand)
        ).to.be.revertedWith("eip2098 not allowed")

        await expect(
            broker
                .connect(transcoder)
                .redeemWinningTicket(ticket, senderSig, recipientRand)
        )

        const endDeposit = (await broker.getSenderInfo(broadcaster.address))
            .sender.deposit

        expect(endDeposit, "wrong endDeposit").to.equal(
            deposit.sub(ticket.faceValue)
        )

        const round = await roundsManager.currentRound()

        // there are no delegators so pendingFees(transcoder, currentRound) will include all fees
        expect(
            await bondingManager.pendingFees(transcoder.address, round)
        ).to.equal(faceValue)
    })
})
