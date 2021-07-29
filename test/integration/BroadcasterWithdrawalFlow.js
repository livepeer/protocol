import {contractId} from "../../utils/helpers"
import BN from "bn.js"
import calcTxCost from "../helpers/calcTxCost"

const Controller = artifacts.require("Controller")
const TicketBroker = artifacts.require("TicketBroker")
const BondingManager = artifacts.require("BondingManager")
const Minter = artifacts.require("Minter")
const AdjustableRoundsManager = artifacts.require("AdjustableRoundsManager")
const LivepeerToken = artifacts.require("LivepeerToken")

describe("BroadcasterWithdrawalFlow", accounts => {
    const broadcaster = accounts[0]

    let broker
    let minter
    let roundsManager

    const unlockPeriod = 100

    before(async () => {
        const controller = await Controller.deployed()
        await controller.unpause()

        const brokerAddr = await controller.getContract(contractId("JobsManager"))
        broker = await TicketBroker.at(brokerAddr)

        const bondingManagerAddr = await controller.getContract(contractId("BondingManager"))
        await BondingManager.at(bondingManagerAddr)

        const roundsManagerAddr = await controller.getContract(contractId("RoundsManager"))
        roundsManager = await AdjustableRoundsManager.at(roundsManagerAddr)

        const tokenAddr = await controller.getContract(contractId("LivepeerToken"))
        await LivepeerToken.at(tokenAddr)

        const minterAddr = await controller.getContract(contractId("Minter"))
        minter = await Minter.at(minterAddr)

        // The reason for this intervention is that fast-forwarding the current default
        // unlockPeriod takes a very long time
        await broker.setUnlockPeriod(unlockPeriod)
    })

    it("broadcaster withdraws deposit and penalty escrow", async () => {
        const deposit = new BN(web3.utils.toWei("1", "ether"))
        const reserve = new BN(web3.utils.toWei("1", "ether"))
        await broker.fundDeposit({from: broadcaster, value: deposit})
        await broker.fundReserve({from: broadcaster, value: reserve})
        const withdrawalAmount = deposit.add(reserve)

        await broker.unlock({from: broadcaster})
        const unlockPeriod = (await broker.unlockPeriod.call()).toNumber()
        const currentRound = (await roundsManager.currentRound()).toNumber()
        const roundLength = (await roundsManager.roundLength()).toNumber()
        await roundsManager.setBlockNum((currentRound * roundLength) + (unlockPeriod * roundLength))

        const startBroadcasterBalance = new BN(await web3.eth.getBalance(broadcaster))
        const startMinterBalance = new BN(await web3.eth.getBalance(minter.address))

        const withdrawResult = await broker.withdraw({from: broadcaster})

        const endMinterBalance = new BN(await web3.eth.getBalance(minter.address))
        assert.equal(startMinterBalance.sub(endMinterBalance).toString(), withdrawalAmount.toString())

        const txCost = await calcTxCost(withdrawResult)
        const endBroadcasterBalance = new BN(await web3.eth.getBalance(broadcaster))
        assert.equal(endBroadcasterBalance.sub(startBroadcasterBalance).add(txCost).toString(), withdrawalAmount.toString())
    })
})
