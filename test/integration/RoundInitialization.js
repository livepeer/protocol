import {constants} from "../../utils/constants"

import chai, {expect} from "chai"
import {solidity} from "ethereum-waffle"
import {ethers} from "hardhat"

chai.use(solidity)

describe("RoundInitialization", () => {
    let signers
    let controller
    let stakingManager
    let roundsManager
    let token

    let bondAmount

    const mineAndInitializeRound = async roundsManager => {
        const roundLength = await roundsManager.roundLength()
        await roundsManager.mineBlocks(roundLength)
        await roundsManager.initializeRound()
    }

    const registerTranscodersAndInitializeRound = async (amount, transcoders, stakingManager, token, roundsManager) => {
        for (const tr of transcoders) {
            await token.transfer(tr.address, amount)
            await token.connect(tr).approve(stakingManager.address, amount)
            await stakingManager.connect(tr).bond(amount, tr.address)
            await stakingManager.connect(tr).transcoder(0, 100)
        }

        await mineAndInitializeRound(roundsManager)
    }

    before(async () => {
        signers = await ethers.getSigners()

        const fixture = await deployments.fixture(["Contracts"])

        controller = await ethers.getContractAt("Controller", fixture.Controller.address)
        await controller.unpause()

        stakingManager = await ethers.getContractAt("StakingManager", fixture.StakingManager.address)
        roundsManager = await ethers.getContractAt("AdjustableRoundsManager", fixture.AdjustableRoundsManager.address)
        token = await ethers.getContractAt("LivepeerToken", fixture.LivepeerToken.address)

        bondAmount = ethers.BigNumber.from(10).mul(constants.TOKEN_UNIT.toString())
        await mineAndInitializeRound(roundsManager)
    })

    it("initializes a round with numActiveTranscoders = 10", async () => {
        const newTranscoders = signers.slice(1, 11)
        await registerTranscodersAndInitializeRound(bondAmount, newTranscoders, stakingManager, token, roundsManager)

        expect(await stakingManager.currentRoundTotalActiveStake()).to.equal(
            bondAmount.mul(10),
            "wrong total active stake"
        )
    })

    it("initializes a round with numActiveTranscoders = 15", async () => {
        const newTranscoders = signers.slice(11, 16)
        await stakingManager.setNumActiveTranscoders(15)
        expect(await stakingManager.getTranscoderPoolMaxSize()).to.equal(15, "wrong max # of active transcoders")
        await registerTranscodersAndInitializeRound(bondAmount, newTranscoders, stakingManager, token, roundsManager)

        expect(await stakingManager.currentRoundTotalActiveStake()).to.equal(
            bondAmount.mul(15),
            "wrong total active stake"
        )
    })

    it("initializes a round with numActiveTranscoders = 20", async () => {
        const newTranscoders = signers.slice(16, 21)

        await stakingManager.setNumActiveTranscoders(20)
        expect(await stakingManager.getTranscoderPoolMaxSize()).to.equal(20, "wrong max # of active transcoders")

        await registerTranscodersAndInitializeRound(bondAmount, newTranscoders, stakingManager, token, roundsManager)

        expect(await stakingManager.currentRoundTotalActiveStake()).to.equal(
            bondAmount.mul(20),
            "wrong total active stake"
        )
    })

    it("initializes a round with numActiveTranscoders = 30", async () => {
        const newTranscoders = signers.slice(21, 31)

        await stakingManager.setNumActiveTranscoders(30)
        expect(await stakingManager.getTranscoderPoolMaxSize()).to.equal(30, "wrong max # of active transcoders")
        await registerTranscodersAndInitializeRound(bondAmount, newTranscoders, stakingManager, token, roundsManager)

        await mineAndInitializeRound(roundsManager)

        expect(await stakingManager.currentRoundTotalActiveStake()).to.equal(
            bondAmount.mul(30),
            "wrong total active stake"
        )
    })

    it("initializes a round with numActiveTranscoders = 40", async () => {
        const newTranscoders = signers.slice(31, 41)
        await stakingManager.setNumActiveTranscoders(40)
        expect(await stakingManager.getTranscoderPoolMaxSize()).to.equal(40, "wrong max # of active transcoders")

        await registerTranscodersAndInitializeRound(bondAmount, newTranscoders, stakingManager, token, roundsManager)

        expect(await stakingManager.currentRoundTotalActiveStake()).to.equal(
            bondAmount.mul(40),
            "wrong total active stake"
        )
    })
})
