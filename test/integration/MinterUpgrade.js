import {contractId} from "../../utils/helpers"
import {ethers} from "hardhat"
import setupIntegrationTest from "../helpers/setupIntegrationTest"

import chai, {assert, expect} from "chai"
import {solidity} from "ethereum-waffle"
chai.use(solidity)

describe("MinterUpgrade", () => {
    const NEW_INFLATION_CHANGE = ethers.constants.One

    let transcoder1
    let transcoder2
    let broadcaster1
    let broadcaster2

    let controller
    let bondingManager
    let roundsManager
    let token
    let minter
    let broker

    let roundLength

    let signers

    const checkWithdrawalResult = async broadcaster => {
        const unlockPeriod = await broker.unlockPeriod()

        await broker.connect(broadcaster).unlock()

        await roundsManager.mineBlocks(unlockPeriod.mul(roundLength))

        const startMinterBalance = await ethers.provider.getBalance(
            minter.address
        )
        const startInfo = await broker.getSenderInfo(broadcaster.address)

        await broker.connect(broadcaster).withdraw()

        const endMinterBalance = await ethers.provider.getBalance(
            minter.address
        )
        const endInfo = await broker.getSenderInfo(broadcaster.address)

        assert.equal(endInfo.sender.deposit.toString(), "0")
        assert.equal(
            startMinterBalance.sub(endMinterBalance).toString(),
            startInfo.sender.deposit.toString()
        )
    }

    before(async () => {
        signers = await ethers.getSigners()
        transcoder1 = signers[0]
        transcoder2 = signers[1]
        broadcaster1 = signers[2]
        broadcaster2 = signers[3]

        const fixture = await setupIntegrationTest()

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

        broker = await ethers.getContractAt(
            "TicketBroker",
            fixture.TicketBroker.address
        )

        // Set target bonding rate to 0 so inflation decreases each round
        await minter.setTargetBondingRate(0)

        const amount = ethers.utils.parseEther("10")
        await token.transfer(transcoder1.address, amount)
        await token.transfer(transcoder2.address, amount)

        // Register transcoder 1
        await token.connect(transcoder1).approve(bondingManager.address, amount)
        await bondingManager
            .connect(transcoder1)
            .bond(amount, transcoder1.address)

        // Register transcoder 2
        await token.connect(transcoder2).approve(bondingManager.address, amount)
        await bondingManager
            .connect(transcoder2)
            .bond(amount, transcoder2.address)

        const deposit = ethers.utils.parseEther("1")

        // Deposit ETH from broadcaster 1
        await broker.connect(broadcaster1).fundDeposit({value: deposit})

        // Deposit ETH from broadcaster 2
        await broker.connect(broadcaster2).fundDeposit({value: deposit})

        roundLength = await roundsManager.roundLength()
        await roundsManager.setBlockHash(web3.utils.keccak256("foo"))
    })

    it("new round is initialized with inflation set based on old inflation change value", async () => {
        const startInflation = await minter.inflation()

        await roundsManager.mineBlocks(roundLength.toNumber() * 1000)
        await roundsManager.initializeRound()

        const endInflation = await minter.inflation()

        assert.equal(
            startInflation.sub(endInflation).toString(),
            (await minter.inflationChange()).toString()
        )
    })

    it("transcoder 1 calls reward pre-upgrade and receives tokens", async () => {
        const startStake = await bondingManager.transcoderTotalStake(
            transcoder1.address
        )

        await bondingManager.connect(transcoder1).reward()

        const endStake = await bondingManager.transcoderTotalStake(
            transcoder1.address
        )
        expect(endStake.sub(startStake)).to.be.gt(ethers.constants.Zero)
    })

    it("Minter upgrade is executed", async () => {
        const inflationChange = await minter.inflationChange()
        const tokenBal = await token.balanceOf(minter.address)
        const ethBal = await ethers.provider.getBalance(minter.address)

        // Sanity check
        assert.notOk(inflationChange.eq(NEW_INFLATION_CHANGE))

        const targetBondingRate = await minter.targetBondingRate()
        const maxInflation = await minter.maxInflation()
        const minInflation = await minter.minInflation()

        // Deploy the new Minter
        const newMinter = await (
            await ethers.getContractFactory("Minter")
        ).deploy(
            controller.address,
            0,
            NEW_INFLATION_CHANGE,
            targetBondingRate,
            maxInflation,
            minInflation
        )

        // Migrate from old Minter to new Minter
        await minter.migrateToNewMinter(newMinter.address)

        // Migrate variables affected by RoundsManager from old Minter to new Minter
        await newMinter.migrateOldMinterState()

        // Register the new MinterinflationChange
        await controller.setContractInfo(
            contractId("Minter"),
            newMinter.address,
            "0x3031323334353637383930313233343536373839"
        )

        // Check that the new Minter has the correct inflationChange value
        assert.equal(
            (await newMinter.inflationChange()).toString(),
            NEW_INFLATION_CHANGE.toString(),
            "inflationChange mismatch"
        )

        // Migrating balances is done correctly
        assert.equal(
            (await token.balanceOf(newMinter.address)).toString(),
            tokenBal.toString(),
            "Token balance mismatch"
        )
        assert.equal(
            (await ethers.provider.getBalance(newMinter.address)).toString(),
            ethBal.toString(),
            "ETH balance mismatch"
        )

        // Migrating old state variables are done correctly
        assert.equal(
            (await newMinter.currentMintableTokens()).toString(),
            (await minter.currentMintableTokens()).toString(),
            "currentMintableTokens mismatch"
        )
        assert.equal(
            (await newMinter.currentMintedTokens()).toString(),
            (await minter.currentMintedTokens()).toString(),
            "currentMintedTokens mismatch"
        )
        assert.equal(
            (await newMinter.inflation()).toString(),
            (await minter.inflation()).toString(),
            "inflation mismatch"
        )

        // Grant new Minter minting rights
        await token.grantRole(
            ethers.utils.solidityKeccak256(["string"], ["MINTER_ROLE"]),
            newMinter.address
        )

        // Set minter var to new Minter
        minter = newMinter
    })

    it("transcoder 2 calls reward post-upgrade in the same round and receives reward", async () => {
        const startStake = await bondingManager.transcoderTotalStake(
            transcoder2.address
        )

        await bondingManager.connect(transcoder2).reward()

        const endStake = await bondingManager.transcoderTotalStake(
            transcoder2.address
        )

        expect(endStake.sub(startStake)).to.be.gt(ethers.constants.Zero)
    })

    it("new round is initialized and inflation is set based on new inflation change value", async () => {
        const startInflation = await minter.inflation()

        const currBlock = await roundsManager.blockNum()
        const blocks = (await roundsManager.currentRound())
            .mul(roundLength)
            .add(roundLength)
            .sub(currBlock)
        await roundsManager.mineBlocks(blocks)
        await roundsManager.initializeRound()

        const endInflation = await minter.inflation()

        assert.equal(
            startInflation.sub(endInflation).toString(),
            NEW_INFLATION_CHANGE.toString()
        )
    })

    it("transcoder 1 calls reward in the round after the upgrade round and receives tokens", async () => {
        const startStake = await bondingManager.transcoderTotalStake(
            transcoder1.address
        )

        await bondingManager.connect(transcoder1).reward()

        const endStake = await bondingManager.transcoderTotalStake(
            transcoder1.address
        )

        expect(endStake.sub(startStake)).gt(ethers.constants.Zero)
    })

    it("transcoder 2 calls reward in the round after the upgrade round and receives tokens", async () => {
        const startStake = await bondingManager.transcoderTotalStake(
            transcoder2.address
        )

        await bondingManager.connect(transcoder2).reward()

        const endStake = await bondingManager.transcoderTotalStake(
            transcoder2.address
        )

        assert.ok(endStake.sub(startStake).gt(ethers.constants.Zero))
    })

    it("broadcaster 1 withdraws deposit", async () => {
        await checkWithdrawalResult(broadcaster1)
    })

    it("broadcaster 2 withdraws deposit", async () => {
        await checkWithdrawalResult(broadcaster2)
    })
})
