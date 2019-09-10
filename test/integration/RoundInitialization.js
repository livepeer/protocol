import {contractId} from "../../utils/helpers"
import BigNumber from "bignumber.js"

const Controller = artifacts.require("Controller")
const BondingManager = artifacts.require("BondingManager")
const AdjustableRoundsManager = artifacts.require("AdjustableRoundsManager")
const LivepeerToken = artifacts.require("LivepeerToken")

contract("RoundInitialization", accounts => {
    const TOKEN_UNIT = 10 ** 18

    let controller
    let bondingManager
    let roundsManager
    let token

    let bondAmount

    const mineAndInitializeRound = async roundsManager => {
        const roundLength = await roundsManager.roundLength.call()
        await roundsManager.mineBlocks(roundLength)
        await roundsManager.initializeRound()
    }

    const registerTranscodersAndInitializeRound = async (amount, transcoders, bondingManager, token, roundsManager) => {
        for (let tr of transcoders) {
            await token.transfer(tr, amount)
            await token.approve(bondingManager.address, amount, {from: tr})
            await bondingManager.bond(amount, tr, {from: tr})
            await bondingManager.transcoder(0, 100, {from: tr})
        }

        await mineAndInitializeRound(roundsManager)
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

        bondAmount = new BigNumber(1).times(TOKEN_UNIT)

        await mineAndInitializeRound(roundsManager)
    })

    it("initializes a round with numActiveTranscoders = 10", async () => {
        const newTranscoders = accounts.slice(1, 11)
        await registerTranscodersAndInitializeRound(bondAmount, newTranscoders, bondingManager, token, roundsManager)

        assert.equal(await bondingManager.currentRoundTotalActiveStake(), bondAmount.times(10).toNumber(), "wrong total active stake")
    })

    it("initializes a round with numActiveTranscoders = 15", async () => {
        const newTranscoders = accounts.slice(11, 26)
        await bondingManager.setNumActiveTranscoders(15)
        assert.equal(await bondingManager.getTranscoderPoolMaxSize(), 15, "wrong max # of active transcoders")
        await registerTranscodersAndInitializeRound(bondAmount, newTranscoders, bondingManager, token, roundsManager)

        assert.equal(await bondingManager.currentRoundTotalActiveStake(), bondAmount.times(15).toNumber(), "wrong total active stake")
    })

    it("initializes a round with numActiveTranscoders = 20", async () => {
        const newTranscoders = accounts.slice(26, 46)

        await bondingManager.setNumActiveTranscoders(20)
        assert.equal(await bondingManager.getTranscoderPoolMaxSize(), 20, "wrong max # of active transcoders")

        await registerTranscodersAndInitializeRound(bondAmount, newTranscoders, bondingManager, token, roundsManager)

        assert.equal(await bondingManager.currentRoundTotalActiveStake(), bondAmount.times(20).toNumber(), "wrong total active stake")
    })

    it("initializes a round with numActiveTranscoders = 30", async () => {
        const newTranscoders = accounts.slice(46, 76)

        await bondingManager.setNumActiveTranscoders(30)
        assert.equal(await bondingManager.getTranscoderPoolMaxSize(), 30, "wrong max # of active transcoders")
        await registerTranscodersAndInitializeRound(bondAmount, newTranscoders, bondingManager, token, roundsManager)

        await mineAndInitializeRound(roundsManager)

        assert.equal(await bondingManager.currentRoundTotalActiveStake(), bondAmount.times(30).toNumber(), "wrong total active stake")
    })

    it("initializes a round with numActiveTranscoders = 40", async () => {
        const newTranscoders = accounts.slice(76, 100)
        await bondingManager.setNumActiveTranscoders(40)
        assert.equal(await bondingManager.getTranscoderPoolMaxSize(), 40, "wrong max # of active transcoders")

        await registerTranscodersAndInitializeRound(bondAmount, newTranscoders, bondingManager, token, roundsManager)

        assert.equal(await bondingManager.currentRoundTotalActiveStake(), bondAmount.times(40).toNumber(), "wrong total active stake")
    })
})
