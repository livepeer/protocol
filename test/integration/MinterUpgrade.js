import {contractId} from "../../utils/helpers"
import {constants} from "../../utils/constants"
import BN from "bn.js"

const Controller = artifacts.require("Controller")
const BondingManager = artifacts.require("BondingManager")
const Minter = artifacts.require("Minter")
const AdjustableRoundsManager = artifacts.require("AdjustableRoundsManager")
const LivepeerToken = artifacts.require("LivepeerToken")
const TicketBroker = artifacts.require("TicketBroker")

contract("MinterUpgrade", accounts => {
    const NEW_INFLATION_CHANGE = new BN(1)

    const transcoder1 = accounts[1]
    const transcoder2 = accounts[2]
    const broadcaster1 = accounts[3]
    const broadcaster2 = accounts[4]

    let controller
    let bondingManager
    let roundsManager
    let token
    let minter
    let broker

    let roundLength

    const checkWithdrawalResult = async broadcaster => {
        const unlockPeriod = await broker.unlockPeriod()

        await broker.unlock({from: broadcaster})

        await roundsManager.mineBlocks(unlockPeriod.mul(roundLength))

        const startMinterBalance = new BN(await web3.eth.getBalance(minter.address))
        const startInfo = await broker.getSenderInfo(broadcaster)

        await broker.withdraw({from: broadcaster})

        const endMinterBalance = new BN(await web3.eth.getBalance(minter.address))
        const endInfo = await broker.getSenderInfo(broadcaster)

        assert.equal(endInfo.sender.deposit.toString(), "0")
        assert.equal(startMinterBalance.sub(endMinterBalance).toString(), startInfo.sender.deposit.toString())
    }

    before(async () => {
        controller = await Controller.deployed()
        await controller.unpause()

        const bondingManagerAddr = await controller.getContract(contractId("BondingManager"))
        bondingManager = await BondingManager.at(bondingManagerAddr)

        const roundsManagerAddr = await controller.getContract(contractId("RoundsManager"))
        roundsManager = await AdjustableRoundsManager.at(roundsManagerAddr)

        const tokenAddr = await controller.getContract(contractId("LivepeerToken"))
        token = await LivepeerToken.at(tokenAddr)

        const minterAddr = await controller.getContract(contractId("Minter"))
        minter = await Minter.at(minterAddr)

        const brokerAddr = await controller.getContract(contractId("TicketBroker"))
        broker = await TicketBroker.at(brokerAddr)

        // Set target bonding rate to 0 so inflation decreases each round
        await minter.setTargetBondingRate(0)

        const amount = new BN(10).mul(constants.TOKEN_UNIT)
        await token.transfer(transcoder1, amount, {from: accounts[0]})
        await token.transfer(transcoder2, amount, {from: accounts[0]})

        // Register transcoder 1
        await token.approve(bondingManager.address, amount, {from: transcoder1})
        await bondingManager.bond(amount, transcoder1, {from: transcoder1})

        // Register transcoder 2
        await token.approve(bondingManager.address, amount, {from: transcoder2})
        await bondingManager.bond(amount, transcoder2, {from: transcoder2})

        const deposit = new BN(web3.utils.toWei("1", "ether"))

        // Deposit ETH from broadcaster 1
        await broker.fundDeposit({from: broadcaster1, value: deposit})

        // Deposit ETH from broadcaster 2
        await broker.fundDeposit({from: broadcaster2, value: deposit})

        roundLength = await roundsManager.roundLength()
        await roundsManager.setBlockHash(web3.utils.keccak256("foo"))
    })

    it("new round is initialized with inflation set based on old inflation change value", async () => {
        const startInflation = await minter.inflation()

        await roundsManager.mineBlocks(roundLength.toNumber() * 1000)
        await roundsManager.initializeRound()

        const endInflation = await minter.inflation()

        assert.equal(startInflation.sub(endInflation).toString(), (await minter.inflationChange()).toString())
    })

    it("transcoder 1 calls reward pre-upgrade and receives tokens", async () => {
        const startStake = await bondingManager.transcoderTotalStake(transcoder1)

        await bondingManager.reward({from: transcoder1})

        const endStake = await bondingManager.transcoderTotalStake(transcoder1)

        assert.ok(endStake.sub(startStake).gt(new BN(0)))
    })

    it("Minter upgrade is executed", async () => {
        const inflation = await minter.inflation()
        const inflationChange = await minter.inflationChange()
        const targetBondingRate = await minter.targetBondingRate()
        const tokenBal = await token.balanceOf(minter.address)
        const ethBal = await web3.eth.getBalance(minter.address)

        // Sanity check
        assert.notOk(inflationChange.eq(NEW_INFLATION_CHANGE))

        // Deploy the new Minter
        const newMinter = await Minter.new(controller.address, inflation, NEW_INFLATION_CHANGE, targetBondingRate)

        // Pause the Controller so migrateToNewMinter() can be called
        await controller.pause()

        // Migrate from old Minter to new Minter
        await minter.migrateToNewMinter(newMinter.address)

        // Register the new Minter
        await controller.setContractInfo(contractId("Minter"), newMinter.address, "0x123")

        // Unpause the Controller after migrateToNewMinter() has been called
        await controller.unpause()

        // Check new Minter parameters and balances
        assert.equal((await newMinter.inflation()).toString(), inflation.toString())
        assert.equal((await newMinter.targetBondingRate()).toString(), targetBondingRate.toString())
        assert.equal((await newMinter.inflationChange()).toString(), NEW_INFLATION_CHANGE.toString())
        assert.equal((await token.balanceOf(newMinter.address)).toString(), tokenBal.toString())
        assert.equal((await web3.eth.getBalance(newMinter.address)).toString(), ethBal.toString())

        // Check that internal state is reset
        assert.equal((await newMinter.currentMintableTokens()).toString(), "0")
        assert.equal((await newMinter.currentMintedTokens()).toString(), "0")

        // Check that new Minter can mint tokens
        assert.equal(await token.owner.call(), newMinter.address)

        // Set minter var to new Minter
        minter = newMinter
    })

    it("transcoder 2 calls reward post-upgrade in the same round and receives nothing", async () => {
        const startStake = await bondingManager.transcoderTotalStake(transcoder2)

        await bondingManager.reward({from: transcoder2})

        const endStake = await bondingManager.transcoderTotalStake(transcoder2)

        assert.equal(endStake.sub(startStake).toString(), "0")
    })

    it("new round is initialized and inflation is set based on new inflation change value", async () => {
        const startInflation = await minter.inflation()

        const currBlock = await roundsManager.blockNum()
        const blocks = (await roundsManager.currentRound()).mul(roundLength).add(roundLength).sub(currBlock)
        await roundsManager.mineBlocks(blocks)
        await roundsManager.initializeRound()

        const endInflation = await minter.inflation()

        assert.equal(startInflation.sub(endInflation).toString(), NEW_INFLATION_CHANGE.toString())
    })

    it("transcoder 1 calls reward in the round after the upgrade round and receives tokens", async () => {
        const startStake = await bondingManager.transcoderTotalStake(transcoder1)

        await bondingManager.reward({from: transcoder1})

        const endStake = await bondingManager.transcoderTotalStake(transcoder1)

        assert.ok(endStake.sub(startStake).gt(new BN(0)))
    })

    it("transcoder 2 calls reward in the round after the upgrade round and receives tokens", async () => {
        const startStake = await bondingManager.transcoderTotalStake(transcoder2)

        await bondingManager.reward({from: transcoder2})

        const endStake = await bondingManager.transcoderTotalStake(transcoder2)

        assert.ok(endStake.sub(startStake).gt(new BN(0)))
    })

    it("broadcaster 1 withdraws deposit", async () => {
        await checkWithdrawalResult(broadcaster1)
    })

    it("broadcaster 2 withdraws deposit", async () => {
        await checkWithdrawalResult(broadcaster2)
    })
})
