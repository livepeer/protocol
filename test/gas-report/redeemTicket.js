import {contractId} from "../../utils/helpers"
import RPC from "../../utils/rpc"
import {
    DUMMY_TICKET_CREATION_ROUND_BLOCK_HASH,
    createAuxData,
    createWinningTicket,
    getTicketHash
} from "../helpers/ticket"
import signMsg from "../helpers/signMsg"

const Controller = artifacts.require("Controller")
const BondingManager = artifacts.require("BondingManager")
const AdjustableRoundsManager = artifacts.require("AdjustableRoundsManager")
const LivepeerToken = artifacts.require("LivepeerToken")
const TicketBroker = artifacts.require("TicketBroker")

contract("redeem ticket gas report", accounts => {
    let rpc
    let snapshotId

    let broker

    let transcoder
    let broadcaster

    let ticketAuxData

    const deposit = 1000

    before(async () => {
        rpc = new RPC(web3)

        transcoder = accounts[0]
        broadcaster = accounts[1]

        const controller = await Controller.deployed()

        const bondingManagerAddr = await controller.getContract(contractId("BondingManager"))
        const bondingManager = await BondingManager.at(bondingManagerAddr)

        const roundsManagerAddr = await controller.getContract(contractId("RoundsManager"))
        const roundsManager = await AdjustableRoundsManager.at(roundsManagerAddr)

        const tokenAddr = await controller.getContract(contractId("LivepeerToken"))
        const token = await LivepeerToken.at(tokenAddr)

        const brokerAddr = await controller.getContract(contractId("TicketBroker"))
        broker = await TicketBroker.at(brokerAddr)

        await controller.unpause()

        // Register transcoder
        const stake = 100
        await token.transfer(transcoder, stake)
        await token.approve(bondingManager.address, stake, {from: transcoder})
        await bondingManager.bond(stake, transcoder, {from: transcoder})

        // Deposit funds for broadcaster
        await broker.fundDepositAndReserve(
            deposit,
            1000,
            {from: broadcaster, value: deposit + 1000}
        )

        // Fast forward to start of new round to lock in active set
        const roundLength = await roundsManager.roundLength()
        await roundsManager.mineBlocks(roundLength.toNumber())
        // Set mock block hash
        await roundsManager.setBlockHash(DUMMY_TICKET_CREATION_ROUND_BLOCK_HASH)
        await roundsManager.initializeRound()

        // Construct ticketAuxData (creation round + creation round block hash)
        const currentRound = await roundsManager.currentRound()
        ticketAuxData = createAuxData(currentRound.toNumber(), DUMMY_TICKET_CREATION_ROUND_BLOCK_HASH)
    })

    beforeEach(async () => {
        snapshotId = await rpc.snapshot()
    })

    afterEach(async () => {
        await rpc.revert(snapshotId)
    })

    it("redeem ticket and only draw from deposit", async () => {
        const recipientRand = 5
        // Set faceValue equal to broadcaster's deposit
        const faceValue = deposit
        const ticket = createWinningTicket(transcoder, broadcaster, recipientRand, faceValue, ticketAuxData)
        const senderSig = await signMsg(getTicketHash(ticket), broadcaster)

        // Ticket faceValue is equal to broadcaster's deposit so will only draw from deposit
        await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: transcoder})
    })

    it("redeem ticket and draw from deposit and reserve", async () => {
        const recipientRand = 5
        // Set faceValue greater than broadcaster's current deposit
        const faceValue = deposit + 500
        const ticket = createWinningTicket(transcoder, broadcaster, recipientRand, faceValue, ticketAuxData)
        const senderSig = await signMsg(getTicketHash(ticket), broadcaster)

        // Ticket faceValue is greater than broadcaster's deposit so will draw from both deposit and reserve
        await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: transcoder})
    })
})
