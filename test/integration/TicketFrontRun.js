import RPC from "../../utils/rpc"
import {contractId} from "../../utils/helpers"
import {constants} from "../../utils/constants"
import BN from "bn.js"
import {createWinningTicket, getTicketHash} from "../helpers/ticket"
import signMsg from "../helpers/signMsg"
import expectRevertWithReason from "../helpers/expectFail"

const Controller = artifacts.require("Controller")
const TicketBroker = artifacts.require("TicketBroker")
const BondingManager = artifacts.require("BondingManager")
const AdjustableRoundsManager = artifacts.require("AdjustableRoundsManager")
const LivepeerToken = artifacts.require("LivepeerToken")

contract("TicketFrontRun", ([deployer, broadcaster, evilSybilAccount, evilNonActiveTranscoder, evilActiveTranscoder, ...otherAccounts]) => {
    let honestTranscoder = otherAccounts[0]

    let rpc
    let snapshotId

    let controller
    let broker
    let bondingManager
    let roundsManager

    let deposit
    let reserve
    let reserveAlloc

    const newWinningTicket = async (recipient, sender, faceValue, recipientRand) => {
        const block = await roundsManager.blockNum()
        const creationRound = (await roundsManager.currentRound()).toString()
        const creationRoundBlockHash = await roundsManager.blockHash(block)
        const auxData = web3.eth.abi.encodeParameters(
            ["uint256", "bytes32"],
            [creationRound, creationRoundBlockHash]
        )

        return createWinningTicket(recipient, sender, recipientRand, faceValue, auxData)
    }

    before(async () => {
        rpc = new RPC(web3)

        controller = await Controller.deployed()
        await controller.unpause()

        const brokerAddr = await controller.getContract(contractId("JobsManager"))
        broker = await TicketBroker.at(brokerAddr)

        const bondingManagerAddr = await controller.getContract(contractId("BondingManager"))
        bondingManager = await BondingManager.at(bondingManagerAddr)

        const roundsManagerAddr = await controller.getContract(contractId("RoundsManager"))
        roundsManager = await AdjustableRoundsManager.at(roundsManagerAddr)

        const tokenAddr = await controller.getContract(contractId("LivepeerToken"))
        const token = await LivepeerToken.at(tokenAddr)

        const registerTranscoder = async transcoder => {
            const amount = new BN(10).mul(constants.TOKEN_UNIT)
            await token.transfer(transcoder, amount, {from: deployer})
            await token.approve(bondingManager.address, amount, {from: transcoder})
            await bondingManager.bond(amount, transcoder, {from: transcoder})
            await bondingManager.transcoder(0, 0, {from: transcoder})
        }

        const maxActive = (await bondingManager.getTranscoderPoolMaxSize()).toNumber()

        // Register transcoders
        // For this test, we want 1 evil active transcoder and 1 evil non-active transcoder
        // First we'll fill up the active set and leave one slot for the evil active transcoder
        const otherTranscoders = otherAccounts.slice(0, maxActive - 1)
        for (let tr of otherTranscoders) {
            await registerTranscoder(tr)
        }

        // evilActiveTranscoder will represent an active transcoder owned by the malicious broadcaster
        await registerTranscoder(evilActiveTranscoder)

        // evilNonActiveTranscoder will represent a non-active transcoder owned by the malicious broadcaster
        // The active set will be full at this point so evilNonActiveTranscoder will not join the active set
        await registerTranscoder(evilNonActiveTranscoder)

        // Fund the broadcaster
        deposit = 1000000
        reserve = 100000
        reserveAlloc = reserve / (await bondingManager.getTranscoderPoolSize()).toNumber()

        await broker.fundDepositAndReserve(
            deposit,
            reserve,
            {from: broadcaster, value: deposit + reserve}
        )

        const roundLength = await roundsManager.roundLength.call()
        await roundsManager.mineBlocks(roundLength.toNumber() * 1000)
        await roundsManager.setBlockHash(web3.utils.keccak256("foo"))
        await roundsManager.initializeRound()
    })

    beforeEach(async () => {
        snapshotId = await rpc.snapshot()
    })

    afterEach(async () => {
        await rpc.revert(snapshotId)
    })

    it("broadcaster tries to send a winning ticket to its own Sybil account", async () => {
        // Use the same recipientRand for both tickets for ease of testing
        const recipientRand = 5

        // honestTranscoder receives a winning ticket
        // Since honestTranscoder sets the required faceValue, it sets the faceValue to
        // reserveAlloc which is its max allocation from the broadcaster's reserve
        const firstTicket = await newWinningTicket(honestTranscoder, broadcaster, reserveAlloc, recipientRand)
        const firstTicketSig = await signMsg(getTicketHash(firstTicket), broadcaster)

        // The malicious broadcaster sends a winning ticket to its own Sybil account and
        // front runs honestTranscoder's transaction to empty the broadcaster's deposit/reserve so that
        // there are insufficient funds to pay honestTranscoder
        // The face value for this ticket is the broadcaster's deposit AND reserve
        const secondTicket = await newWinningTicket(evilSybilAccount, broadcaster, deposit + reserve, recipientRand)
        const secondTicketSig = await signMsg(getTicketHash(secondTicket), broadcaster)

        // Ticket redemption by evilSybilAccount fails because it is not a registered transcoder
        await expectRevertWithReason(
            broker.redeemWinningTicket(
                secondTicket,
                secondTicketSig,
                recipientRand,
                {from: evilSybilAccount}
            ),
            "transcoder must be registered"
        )

        // Ticket redemption by honestTranscoder confirms on-chain
        await broker.redeemWinningTicket(
            firstTicket,
            firstTicketSig,
            recipientRand,
            {from: honestTranscoder}
        )

        const currentRound = await roundsManager.currentRound()
        const info = await broker.getSenderInfo(broadcaster)

        // honestTranscoder's ticket should be fully covered by the the broadcaster's deposit
        assert.equal(info.sender.deposit.toString(), (deposit - reserveAlloc).toString())
        assert.equal(info.reserve.fundsRemaining.toString(), reserve.toString())

        const honestTranscoderEarningsPool = await bondingManager.getTranscoderEarningsPoolForRound(honestTranscoder, currentRound)
        assert.equal(honestTranscoderEarningsPool.transcoderFeePool.toString(), reserveAlloc.toString())
    })

    it("broadcaster tries to send a winning ticket to its own non-active transcoder", async () => {
        // Use the same recipientRand for both tickets for ease of testing
        const recipientRand = 5
        const currentRound = await roundsManager.currentRound()

        // honestTranscoder receives a winning ticket
        // Since honestTranscoder sets the required faceValue, it sets the faceValue to
        // reserveAlloc which is its max allocation from the broadcaster's reserve
        const firstTicket = await newWinningTicket(honestTranscoder, broadcaster, reserveAlloc, recipientRand)
        const firstTicketSig = await signMsg(getTicketHash(firstTicket), broadcaster)

        // The malicious broadcaster sends a winning ticket to its own non-active transcoder and
        // front runs honestTranscoder's transaction to empty the broadcaster's deposit/reserve so that
        // there are insufficeint funds to pay honestTranscoder
        // The face value for this ticket is the broadcaster's deposit AND reserve
        const secondTicket = await newWinningTicket(evilNonActiveTranscoder, broadcaster, deposit + reserve, recipientRand)
        const secondTicketSig = await signMsg(getTicketHash(secondTicket), broadcaster)

        // Ticket redemption by evilNonActiveTranscoder confirms on-chain
        await broker.redeemWinningTicket(
            secondTicket,
            secondTicketSig,
            recipientRand,
            {from: evilNonActiveTranscoder}
        )

        let info = await broker.getSenderInfo(broadcaster)

        // evilNonActiveTranscoder's ticket should only be able to empty the broadcaster's deposit
        assert.equal(info.sender.deposit.toString(), "0")
        assert.equal(info.reserve.fundsRemaining.toString(), reserve.toString())

        const evilNonActiveTranscoderEarningsPool = await bondingManager.getTranscoderEarningsPoolForRound(evilNonActiveTranscoder, currentRound)
        assert.equal(evilNonActiveTranscoderEarningsPool.transcoderFeePool.toString(), deposit.toString())

        // Ticket redemption by honestTranscoder confirms on-chain
        await broker.redeemWinningTicket(
            firstTicket,
            firstTicketSig,
            recipientRand,
            {from: honestTranscoder}
        )

        info = await broker.getSenderInfo(broadcaster)

        // honestTranscoder's ticket should still be fully covered by the allocation from the broadcaster's reserve
        assert.equal(info.reserve.fundsRemaining.toString(), (reserve - reserveAlloc).toString())

        const honestTranscoderEarningsPool = await bondingManager.getTranscoderEarningsPoolForRound(honestTranscoder, currentRound)
        assert.equal(honestTranscoderEarningsPool.transcoderFeePool.toString(), reserveAlloc.toString())
    })

    it("broadcaster tries to send a winning ticket to its own active transcoder", async () => {
        // Use the same recipientRand for both tickets for ease of testing
        const recipientRand = 5
        const currentRound = await roundsManager.currentRound()

        // honestTranscoder receives a winning ticket
        // Since honestTranscoder sets the required faceValue, it sets the faceValue to
        // reserveAlloc which is its max allocation from the broadcaster's reserve
        const firstTicket = await newWinningTicket(honestTranscoder, broadcaster, reserveAlloc, recipientRand)
        const firstTicketSig = await signMsg(getTicketHash(firstTicket), broadcaster)

        // The malicious broadcaster sends a winning ticket to its own active transcoder and
        // front runs honestTranscoder's transaction to empty the broadcaster's deposit/reserve so that
        // there are insufficient funds to pay honestTranscoder
        // The face value for this ticket is the broadcaster's deposit AND reserve
        const secondTicket = await newWinningTicket(evilActiveTranscoder, broadcaster, deposit + reserve, recipientRand)
        const secondTicketSig = await signMsg(getTicketHash(secondTicket), broadcaster)

        // Ticket redemption by evilActiveTranscoder confirms on-chain
        await broker.redeemWinningTicket(
            secondTicket,
            secondTicketSig,
            recipientRand,
            {from: evilActiveTranscoder}
        )

        let info = await broker.getSenderInfo(broadcaster)

        // evilNonActiveTranscoder's ticket should empty the broadcaster's deposit, but only decrease the reserve by reserveAlloc since
        // evilNonActiveTranscoder cannot claim more than that
        assert.equal(info.sender.deposit.toString(), "0")
        assert.equal(info.reserve.fundsRemaining.toString(), (reserve - reserveAlloc).toString())

        const evilActiveTranscoderEarningsPool = await bondingManager.getTranscoderEarningsPoolForRound(evilActiveTranscoder, currentRound)
        assert.equal(evilActiveTranscoderEarningsPool.transcoderFeePool.toString(), (deposit + reserveAlloc).toString())

        // Ticket redemption by honestTranscoder confirms on-chain
        await broker.redeemWinningTicket(
            firstTicket,
            firstTicketSig,
            recipientRand,
            {from: honestTranscoder}
        )

        info = await broker.getSenderInfo(broadcaster)

        // honestTranscoder's ticket should still still receive the full reserveAlloc amount from the broadcaster's reserve
        assert.equal(info.reserve.fundsRemaining.toString(), (reserve - (2 * reserveAlloc)).toString())

        const honestTranscoderEarningsPool = await bondingManager.getTranscoderEarningsPoolForRound(honestTranscoder, currentRound)
        assert.equal(honestTranscoderEarningsPool.transcoderFeePool.toString(), reserveAlloc.toString())
    })
})
