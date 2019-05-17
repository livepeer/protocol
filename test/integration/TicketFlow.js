import {contractId} from "../../utils/helpers"
import {constants} from "../../utils/constants"
import BN from "bn.js"
import {createWinningTicket, getTicketHash} from "../helpers/ticket"

const Controller = artifacts.require("Controller")
const TicketBroker = artifacts.require("TicketBroker")
const BondingManager = artifacts.require("BondingManager")
const Minter = artifacts.require("Minter")
const AdjustableRoundsManager = artifacts.require("AdjustableRoundsManager")
const LivepeerToken = artifacts.require("LivepeerToken")

contract("TicketFlow", accounts => {
    const transcoder = accounts[0]
    const broadcaster = accounts[1]

    let controller
    let broker
    let bondingManager
    let roundsManager
    let minter
    let token

    let roundLength

    before(async () => {
        controller = await Controller.deployed()
        await controller.unpause()

        const brokerAddr = await controller.getContract(contractId("TicketBroker"))
        broker = await TicketBroker.at(brokerAddr)

        const bondingManagerAddr = await controller.getContract(contractId("BondingManager"))
        bondingManager = await BondingManager.at(bondingManagerAddr)

        const roundsManagerAddr = await controller.getContract(contractId("RoundsManager"))
        roundsManager = await AdjustableRoundsManager.at(roundsManagerAddr)

        const tokenAddr = await controller.getContract(contractId("LivepeerToken"))
        token = await LivepeerToken.at(tokenAddr)

        const minterAddr = await controller.getContract(contractId("Minter"))
        minter = await Minter.at(minterAddr)

        const amount = new BN(10).mul(constants.TOKEN_UNIT)
        await token.transfer(transcoder, amount, {from: accounts[0]})

        // Register transcoder
        await token.approve(bondingManager.address, amount, {from: transcoder})
        await bondingManager.bond(amount, transcoder, {from: transcoder})
        await bondingManager.transcoder(0, 0, 0, {from: transcoder})

        roundLength = await roundsManager.roundLength.call()
        await roundsManager.mineBlocks(roundLength.toNumber() * 1000)
        await roundsManager.setBlockHash(web3.utils.keccak256("foo"))
        await roundsManager.initializeRound()
    })

    it("broadcaster funds deposit and penalty escrow", async () => {
        const deposit = new BN(web3.utils.toWei("1", "ether"))

        await broker.fundDeposit({from: broadcaster, value: deposit})

        assert.equal(await web3.eth.getBalance(minter.address), deposit.toString())

        const reserve = new BN(web3.utils.toWei("1", "ether"))

        await broker.fundReserve({from: broadcaster, value: reserve})

        assert.equal(await web3.eth.getBalance(minter.address), deposit.add(reserve).toString())
    })

    it("broadcaster sends a winning ticket and transcoder redeems it", async () => {
        const block = await roundsManager.blockNum()
        const creationRound = (await roundsManager.currentRound()).toString()
        const creationRoundBlockHash = await roundsManager.blockHash(block)
        const auxData = web3.eth.abi.encodeParameters(
            ["uint256", "bytes32"],
            [creationRound, creationRoundBlockHash]
        )
        const deposit = (await broker.senders.call(broadcaster)).deposit
        const recipientRand = 5
        const faceValue = 1000
        const ticket = createWinningTicket(transcoder, broadcaster, recipientRand, faceValue, auxData)
        const senderSig = await web3.eth.sign(getTicketHash(ticket), broadcaster)

        await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: transcoder})

        const endDeposit = (await broker.senders.call(broadcaster)).deposit.toString()

        assert.equal(endDeposit, deposit.sub(new BN(faceValue)).toString())

        const round = await roundsManager.currentRound()
        const earningsPool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, round)

        assert.equal(earningsPool.transcoderFeePool.toString(), faceValue.toString())
    })

    it("broadcaster double spends by over spending with its deposit", async () => {
        await roundsManager.mineBlocks(roundLength)
        await roundsManager.initializeRound()

        const startSender = await broker.senders.call(broadcaster)
        const startReserve = await broker.remainingReserve(broadcaster)
        const block = await roundsManager.blockNum()
        const creationRound = (await roundsManager.currentRound()).toString()
        const creationRoundBlockHash = await roundsManager.blockHash(block)
        const auxData = web3.eth.abi.encodeParameters(
            ["uint256", "bytes32"],
            [creationRound, creationRoundBlockHash]
        )
        const recipientRand = 6
        const faceValue = startSender.deposit.add(new BN(100)).toString()
        const ticket = createWinningTicket(transcoder, broadcaster, recipientRand, faceValue, auxData)
        const senderSig = await web3.eth.sign(getTicketHash(ticket), broadcaster)

        await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: transcoder})

        const endSender = await broker.senders.call(broadcaster)
        const endReserve = await broker.remainingReserve(broadcaster)
        const reserveDiff = (new BN(startReserve)).sub(new BN(endReserve))

        assert.equal(endSender.deposit.toString(), "0")
        assert.equal(reserveDiff.toString(), "100")

        const round = await roundsManager.currentRound()
        const earningsPool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, round)

        assert.equal(earningsPool.transcoderFeePool.toString(), ticket.faceValue.toString())
    })
})
