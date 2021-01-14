import {contractId} from "../../utils/helpers"
import {constants} from "../../utils/constants"
import {createWinningTicket, getTicketHash} from "../helpers/ticket"
import signMsg from "../helpers/signMsg"
import BN from "bn.js"
import {assert} from "chai"
import {utils} from "ethers"

const Governor = artifacts.require("Governor")
const Controller = artifacts.require("Controller")
const BondingManager = artifacts.require("BondingManager")
const BondingManagerZeroStartFactorsBug = artifacts.require("BondingManagerZeroStartFactorsBug")
const AdjustableRoundsManager = artifacts.require("AdjustableRoundsManager")
const LivepeerToken = artifacts.require("LivepeerToken")
const TicketBroker = artifacts.require("TicketBroker")
const LinkedList = artifacts.require("SortedDoublyLL")
const ManagerProxy = artifacts.require("ManagerProxy")

const executeUpgrade = async (controller, gov, bondingManagerProxyAddress) => {
    const ll = await LinkedList.deployed()
    BondingManager.link("SortedDoublyLL", ll.address)
    const bondingManagerTarget = await BondingManager.new(controller.address)

    // Register the new BondingManager implementation contract
    const pauseData = utils.hexlify(
        utils.arrayify(controller.contract.methods.pause().encodeABI())
    )
    const setInfoData = utils.hexlify(
        utils.arrayify(
            controller.contract.methods.setContractInfo(contractId("BondingManagerTarget"), bondingManagerTarget.address, web3.utils.asciiToHex("0x123")).encodeABI()
        )
    )
    const unpauseData = utils.hexlify(
        utils.arrayify(controller.contract.methods.unpause().encodeABI())
    )
    const update = {
        target: [controller.address, controller.address, controller.address],
        value: ["0", "0", "0"],
        data: [pauseData, setInfoData, unpauseData],
        nonce: 0
    }

    await gov.stage(update, 0)
    await gov.execute(update)

    return await BondingManager.at(bondingManagerProxyAddress)
}

contract("ZeroStartFactorsBug", accounts => {
    let controller
    let bondingManager
    let roundsManager
    let token
    let broker
    let bondingProxy
    let governor

    let roundLength

    const transferAmount = (new BN(100)).mul(constants.TOKEN_UNIT)
    const deposit = (new BN(10)).mul(constants.TOKEN_UNIT)
    const reserve = constants.TOKEN_UNIT
    const faceValue = constants.TOKEN_UNIT.div(new BN(10))

    const NUM_ACTIVE_TRANSCODERS = 10
    const UNBONDING_PERIOD = 2
    const MAX_EARNINGS_CLAIMS_ROUNDS = 20

    const transcoder1 = accounts[0]
    const transcoder2 = accounts[1]
    const broadcaster = accounts[2]
    const delegator1 = accounts[3]
    const delegator2 = accounts[4]
    const delegator3 = accounts[5]
    const delegator4 = accounts[6]
    const delegator5 = accounts[7]

    async function redeemWinningTicket(transcoder, broadcaster, faceValue) {
        const block = await roundsManager.blockNum()
        const creationRound = (await roundsManager.currentRound()).toString()
        const creationRoundBlockHash = await roundsManager.blockHash(block)
        const auxData = web3.eth.abi.encodeParameters(
            ["uint256", "bytes32"],
            [creationRound, creationRoundBlockHash]
        )
        const recipientRand = 5
        const ticket = createWinningTicket(transcoder, broadcaster, recipientRand, faceValue.toString(), auxData)
        const senderSig = await signMsg(getTicketHash(ticket), broadcaster)

        await broker.redeemWinningTicket(ticket, senderSig, recipientRand, {from: transcoder})
    }

    before(async () => {
        controller = await Controller.deployed()
        await controller.unpause()

        // Deploy old BondingManager with the bug
        const ll = await LinkedList.new()
        BondingManagerZeroStartFactorsBug.link("SortedDoublyLL", ll.address)
        const bondingTarget = await BondingManagerZeroStartFactorsBug.new(controller.address)
        await controller.setContractInfo(contractId("BondingManagerTarget"), bondingTarget.address, web3.utils.asciiToHex("0x123"))
        bondingProxy = await ManagerProxy.new(controller.address, contractId("BondingManagerTarget"))
        await controller.setContractInfo(contractId("BondingManager"), bondingProxy.address, web3.utils.asciiToHex("0x123"))
        bondingManager = await BondingManagerZeroStartFactorsBug.at(bondingProxy.address)

        await bondingManager.setUnbondingPeriod(UNBONDING_PERIOD)
        await bondingManager.setNumActiveTranscoders(NUM_ACTIVE_TRANSCODERS)
        await bondingManager.setMaxEarningsClaimsRounds(MAX_EARNINGS_CLAIMS_ROUNDS)

        governor = await Governor.new()
        await controller.transferOwnership(governor.address)

        const bondingManagerAddr = await controller.getContract(contractId("BondingManager"))
        bondingManager = await BondingManager.at(bondingManagerAddr)

        const roundsManagerAddr = await controller.getContract(contractId("RoundsManager"))
        roundsManager = await AdjustableRoundsManager.at(roundsManagerAddr)

        const tokenAddr = await controller.getContract(contractId("LivepeerToken"))
        token = await LivepeerToken.at(tokenAddr)

        const brokerAddr = await controller.getContract(contractId("JobsManager"))
        broker = await TicketBroker.at(brokerAddr)

        roundLength = await roundsManager.roundLength.call()
        await roundsManager.mineBlocks(roundLength.toNumber())
        await roundsManager.initializeRound()

        // Register transcoder
        const register = async transcoder => {
            await token.transfer(transcoder, transferAmount, {from: accounts[0]})
            await token.approve(bondingManager.address, transferAmount, {from: transcoder})
            await bondingManager.bond(transferAmount, transcoder, {from: transcoder})
            await bondingManager.transcoder(50 * constants.PERC_MULTIPLIER, 50 * constants.PERC_MULTIPLIER, {from: transcoder})
        }

        await register(transcoder1)
        await register(transcoder2)

        // Deposit funds for broadcaster
        await broker.fundDepositAndReserve(
            deposit,
            reserve,
            {from: broadcaster, value: deposit.add(reserve)}
        )

        await roundsManager.mineBlocks(roundLength.toNumber())
        await roundsManager.setBlockHash(web3.utils.keccak256("foo"))
        await roundsManager.initializeRound()

        // Set cumulativeRewardFactor for transcoder1 2
        await bondingManager.reward({from: transcoder1})
        // Set cumulativeFeeFactor for transcoder2
        await redeemWinningTicket(transcoder2, broadcaster, faceValue)

        await roundsManager.mineBlocks(roundLength.toNumber())
        await roundsManager.initializeRound()

        // Bond from unbonded
        // Delegate to transcoders
        const bond = async (delegator, transcoder) => {
            await token.transfer(delegator, transferAmount, {from: accounts[0]})
            await token.approve(bondingManager.address, transferAmount, {from: delegator})
            await bondingManager.bond(transferAmount, transcoder, {from: delegator})
        }

        await bond(delegator1, transcoder1)
        await bond(delegator2, transcoder2)

        await roundsManager.mineBlocks(roundLength.toNumber())
        await roundsManager.initializeRound()

        await bond(delegator3, transcoder1)
        await bond(delegator4, transcoder2)

        await roundsManager.mineBlocks(roundLength.toNumber())
        await roundsManager.initializeRound()

        const maxLookback = 100
        await roundsManager.mineBlocks(roundLength.toNumber() * maxLookback)
        await roundsManager.initializeRound()

        await bond(delegator5, transcoder1)

        await roundsManager.mineBlocks(roundLength.toNumber())
        await roundsManager.initializeRound()

        bondingManager = await executeUpgrade(controller, governor, bondingProxy.address)
    })

    describe("lookback", () => {
        it("lookback for cumulativeRewardFactor", async () => {
            const cr = await roundsManager.currentRound()

            // 1 round
            const ps1 = await bondingManager.pendingStake(delegator1, cr.toNumber() - 1)
            const ps2 = await bondingManager.pendingStake(delegator1, cr)

            assert.equal(ps1.toString(), ps2.toString())

            // 2 rounds
            const ps3 = await bondingManager.pendingStake(delegator3, cr.toNumber() - 1)
            const ps4 = await bondingManager.pendingStake(delegator3, cr)

            assert.equal(ps3.toString(), ps4.toString())

            const gas1 = await bondingManager.pendingStake.estimateGas(delegator1, cr)
            const gas2 = await bondingManager.pendingStake.estimateGas(delegator3, cr)
            assert.isAbove(gas2, gas1)
        })

        it("lookback for cumulativeFeeFactor", async () => {
            const cr = await roundsManager.currentRound()

            // 1 round
            const pf1 = await bondingManager.pendingFees(delegator2, cr.toNumber() - 1)
            const pf2 = await bondingManager.pendingFees(delegator2, cr)

            assert.equal(pf1.toString(), pf2.toString())

            // 2 rounds
            const pf3 = await bondingManager.pendingFees(delegator4, cr.toNumber() - 1)
            const pf4 = await bondingManager.pendingFees(delegator4, cr)

            assert.equal(pf3.toString(), pf4.toString())

            const gas1 = await bondingManager.pendingStake.estimateGas(delegator2, cr)
            const gas2 = await bondingManager.pendingStake.estimateGas(delegator4, cr)
            assert.isAbove(gas2, gas1)
        })

        it("does not lookback past MAX_LOOKBACK_ROUNDS", async () => {
            const cr = await roundsManager.currentRound()

            // > MAX_LOOKBACK_ROUNDS
            const ps1 = await bondingManager.pendingStake(delegator5, cr.toNumber() - 1)
            const ps2 = await bondingManager.pendingStake(delegator5, cr)

            // This should not happen on mainnet because we never have to lookback further than MAX_LOOKBACK_ROUNDS
            assert.notEqual(ps1.toString(), ps2.toString())

            const gas1 = await bondingManager.pendingStake.estimateGas(delegator5, cr)

            await roundsManager.mineBlocks(roundLength.toNumber() * 2)
            await roundsManager.initializeRound()

            const gas2 = await bondingManager.pendingStake.estimateGas(delegator5, cr)

            // Gas should not change
            assert.equal(gas1.toString(), gas2.toString())
        })

        it("persists the correct values when claiming", async () => {
            const cr = await roundsManager.currentRound()

            const ps1 = await bondingManager.pendingStake(delegator1, cr)
            const ps3 = await bondingManager.pendingStake(delegator3, cr)
            const pf2 = await bondingManager.pendingFees(delegator2, cr)
            const pf4 = await bondingManager.pendingFees(delegator4, cr)

            await bondingManager.claimEarnings(cr, {from: delegator1})
            await bondingManager.claimEarnings(cr, {from: delegator2})
            await bondingManager.claimEarnings(cr, {from: delegator3})
            await bondingManager.claimEarnings(cr, {from: delegator4})

            const del1 = await bondingManager.getDelegator(delegator1)
            const del2 = await bondingManager.getDelegator(delegator2)
            const del3 = await bondingManager.getDelegator(delegator3)
            const del4 = await bondingManager.getDelegator(delegator4)

            assert.equal(del1.bondedAmount.toString(), ps1.toString())
            assert.equal(del3.bondedAmount.toString(), ps3.toString())
            assert.equal(del2.fees.toString(), pf2.toString())
            assert.equal(del4.fees.toString(), pf4.toString())
        })
    })
})
