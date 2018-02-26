import Fixture from "./helpers/Fixture"
import expectThrow from "../helpers/expectThrow"
import {contractId} from "../../utils/helpers"

const RoundsManager = artifacts.require("RoundsManager")

contract("RoundsManager", accounts => {
    let fixture
    let roundsManager

    const PERC_DIVISOR = 1000000
    const PERC_MULTIPLIER = PERC_DIVISOR / 100

    const ROUND_LENGTH = 50
    const ROUND_LOCK_AMOUNT = 10 * PERC_MULTIPLIER

    before(async () => {
        fixture = new Fixture(web3)
        await fixture.deploy()

        roundsManager = await fixture.deployAndRegister(RoundsManager, "RoundsManager", fixture.controller.address)

        await roundsManager.setRoundLength(ROUND_LENGTH)
        await roundsManager.setRoundLockAmount(ROUND_LOCK_AMOUNT)
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("setController", () => {
        it("should fail if caller is not Controller", async () => {
            await expectThrow(roundsManager.setController(accounts[0]))
        })

        it("should set new Controller", async () => {
            await fixture.controller.updateController(contractId("RoundsManager"), accounts[0])

            assert.equal(await roundsManager.controller.call(), accounts[0], "should set new Controller")
        })
    })

    describe("setRoundLength", () => {
        it("should fail if caller is not the Controller owner", async () => {
            await expectThrow(roundsManager.setRoundLength(10, {from: accounts[2]}))
        })

        it("should fail if provided roundLength == 0", async () => {
            await expectThrow(roundsManager.setRoundLength(0))
        })

        it("should set roundLength before lastRoundLengthUpdateRound and lastRoundLengthUpdateStartBlock when roundLength = 0", async () => {
            const newRoundsManager = await RoundsManager.new(fixture.controller.address)
            const blockNum = web3.eth.blockNumber
            const expLastUpdateRound = Math.floor(blockNum / 50)
            const expLastUpdateStartBlock = expLastUpdateRound * 50

            await newRoundsManager.setRoundLength(50)

            assert.equal(await newRoundsManager.roundLength.call(), 50, "wrong roundLength")
            assert.equal(await newRoundsManager.lastRoundLengthUpdateRound.call(), expLastUpdateRound, "wrong lastRoundLengthUpdateRound")
            assert.equal(await newRoundsManager.lastRoundLengthUpdateStartBlock.call(), expLastUpdateStartBlock, "wrong lastRoundLengthUpdateStartBlock")
        })

        it("should set roundLength, lastRoundLengthUpdateRound and lastRoundLengthUpdateStartBlock when increasing roundLength", async () => {
            const lastUpdateRound = (await roundsManager.lastRoundLengthUpdateRound.call()).toNumber()
            const lastUpdateStartBlock = (await roundsManager.lastRoundLengthUpdateStartBlock.call()).toNumber()

            const blockNum = web3.eth.blockNumber
            const roundLength = await roundsManager.roundLength.call()
            const expLastUpdateRound = lastUpdateRound + Math.floor((blockNum - lastUpdateStartBlock) / roundLength.toNumber())
            const expLastUpdateStartBlock = lastUpdateStartBlock + Math.floor((blockNum - lastUpdateStartBlock) / roundLength.toNumber())

            await roundsManager.setRoundLength(60)

            assert.equal(await roundsManager.roundLength.call(), 60, "wrong roundLength")
            assert.equal(await roundsManager.lastRoundLengthUpdateRound.call(), expLastUpdateRound, "wrong lastRoundLengthUpdateRound")
            assert.equal(await roundsManager.lastRoundLengthUpdateStartBlock.call(), expLastUpdateStartBlock, "wrong lastRoundLengthUpdateStartBlock")
        })

        it("should set roundLength, lastRoundLengthUpdateRound and lastRoundLengthUpdateStartBlock when decreasing roundLength", async () => {
            const lastUpdateRound = (await roundsManager.lastRoundLengthUpdateRound.call()).toNumber()
            const lastUpdateStartBlock = (await roundsManager.lastRoundLengthUpdateStartBlock.call()).toNumber()

            const blockNum = web3.eth.blockNumber
            const roundLength = await roundsManager.roundLength.call()
            const expLastUpdateRound = lastUpdateRound + Math.floor((blockNum - lastUpdateStartBlock) / roundLength.toNumber())
            const expLastUpdateStartBlock = lastUpdateStartBlock + Math.floor((blockNum - lastUpdateStartBlock) / roundLength.toNumber())

            await roundsManager.setRoundLength(40)

            assert.equal(await roundsManager.roundLength.call(), 40, "wrong roundLength")
            assert.equal(await roundsManager.lastRoundLengthUpdateRound.call(), expLastUpdateRound, "wrong lastRoundLengthUpdateRound")
            assert.equal(await roundsManager.lastRoundLengthUpdateStartBlock.call(), expLastUpdateStartBlock, "wrong lastRoundLengthUpdateStartBlock")
        })

        it("should set roundLength, lastRoundLengthUpdateRound and lastRoundLengthUpdateStartBlock multiple times", async () => {
            const lastUpdateRound0 = (await roundsManager.lastRoundLengthUpdateRound.call()).toNumber()
            const lastUpdateStartBlock0 = (await roundsManager.lastRoundLengthUpdateStartBlock.call()).toNumber()

            await fixture.rpc.waitUntilNextBlockMultiple(50)
            await roundsManager.setRoundLength(100)

            const lastUpdateRound1 = lastUpdateRound0 + Math.floor((web3.eth.blockNumber - lastUpdateStartBlock0) / 50)
            const lastUpdateStartBlock1 = lastUpdateStartBlock0 + Math.floor((web3.eth.blockNumber - lastUpdateStartBlock0) / 50) * 50

            await fixture.rpc.wait(50)
            await roundsManager.setRoundLength(50)

            const lastUpdateRound2 = lastUpdateRound1 + Math.floor((web3.eth.blockNumber - lastUpdateStartBlock1) / 100)
            const lastUpdateStartBlock2 = lastUpdateStartBlock1 + Math.floor((web3.eth.blockNumber - lastUpdateStartBlock1) / 100) * 100

            assert.isAtLeast(lastUpdateRound2, lastUpdateRound1, "lastRoundLengthUpdateRound cannot decrease")
            assert.isAtLeast(lastUpdateStartBlock2, lastUpdateStartBlock1, "lastRoundLengthUpdateStartBlock cannot decrease")
            assert.equal(await roundsManager.roundLength.call(), 50, "wrong roundLength")
            assert.equal(await roundsManager.lastRoundLengthUpdateRound.call(), lastUpdateRound2, "wrong lastRoundLengthUpdateRound")
            assert.equal(await roundsManager.lastRoundLengthUpdateStartBlock.call(), lastUpdateStartBlock2, "wrong lastRoundLengthUpdateStartBlock")

            await fixture.rpc.wait(20)
            await roundsManager.setRoundLength(20)

            const lastUpdateRound3 = lastUpdateRound2 + Math.floor((web3.eth.blockNumber - lastUpdateStartBlock2) / 50)
            const lastUpdateStartBlock3 = lastUpdateStartBlock2 + Math.floor((web3.eth.blockNumber - lastUpdateStartBlock2) / 50) * 50

            assert.isAtLeast(lastUpdateRound3, lastUpdateRound2, "lastRoundLengthUpdateRound cannot decrease")
            assert.isAtLeast(lastUpdateStartBlock3, lastUpdateStartBlock2, "lastRoundLengthUpdateStartBlock cannot decrease")
            assert.equal(await roundsManager.roundLength.call(), 20, "wrong roundLength")
            assert.equal(await roundsManager.lastRoundLengthUpdateRound.call(), lastUpdateRound3, "wrong lastRoundLengthUpdateRound")
            assert.equal(await roundsManager.lastRoundLengthUpdateStartBlock.call(), lastUpdateStartBlock3, "wrong lastRoundLengthUpdateStartBlock")

            await fixture.rpc.wait(30)
            await roundsManager.setRoundLength(100)

            const lastUpdateRound4 = lastUpdateRound3 + Math.floor((web3.eth.blockNumber - lastUpdateStartBlock3) / 20)
            const lastUpdateStartBlock4 = lastUpdateStartBlock3 + Math.floor((web3.eth.blockNumber - lastUpdateStartBlock3) / 20) * 20

            assert.isAtLeast(lastUpdateRound4, lastUpdateRound3, "lastRoundLengthUpdateRound cannot decrease")
            assert.isAtLeast(lastUpdateStartBlock4, lastUpdateStartBlock3, "lastRoundLengthUpdateStartBlock cannot decrease")
            assert.equal(await roundsManager.roundLength.call(), 100, "wrong roundLength")
            assert.equal(await roundsManager.lastRoundLengthUpdateRound.call(), lastUpdateRound4, "wrong lastRoundLengthUpdateRound")
            assert.equal(await roundsManager.lastRoundLengthUpdateStartBlock.call(), lastUpdateStartBlock4, "wrong lastRoundLengthUpdateStartBlock")
        })
    })

    describe("setRoundLockAmount", () => {
        it("should fail if caller is not the Controller owner", async () => {
            await expectThrow(roundsManager.setRoundLockAmount(50, {from: accounts[2]}))
        })

        it("should fail if provided roundLockAmount is an invalid percentage (> 100%)", async () => {
            await expectThrow(roundsManager.setRoundLockAmount(PERC_DIVISOR + 1))
        })

        it("should set roundLockAmount", async () => {
            await roundsManager.setRoundLockAmount(50)

            assert.equal(await roundsManager.roundLockAmount.call(), 50, "wrong round lock amount")
        })
    })

    describe("initializeRound", () => {
        it("should fail if system is paused", async () => {
            const roundLength = await roundsManager.roundLength.call()
            await fixture.rpc.waitUntilNextBlockMultiple(roundLength.toNumber())
            await fixture.controller.pause()

            await expectThrow(roundsManager.initializeRound())
        })

        it("should fail if current round is already initialized", async () => {
            const roundLength = await roundsManager.roundLength.call()
            await fixture.rpc.waitUntilNextBlockMultiple(roundLength.toNumber())
            await roundsManager.initializeRound()

            await expectThrow(roundsManager.initializeRound())
        })

        it("should set the current round as initialized", async () => {
            const roundLength = await roundsManager.roundLength.call()
            await fixture.rpc.waitUntilNextBlockMultiple(roundLength.toNumber())

            await roundsManager.initializeRound()

            const currentRound = await roundsManager.currentRound()
            assert.equal(await roundsManager.lastInitializedRound(), currentRound.toNumber(), "wrong lastInitializedRound")
        })
    })

    describe("blockNum", () => {
        it("should return the current block number", async () => {
            const latestBlock = web3.eth.blockNumber
            // Note that the current block from the context of the contract is the block to be mined
            assert.equal(await roundsManager.blockNum(), latestBlock + 1, "wrong block number")
        })
    })

    describe("blockHash", () => {
        it("should fail if block is in the future", async () => {
            const latestBlock = web3.eth.blockNumber
            // Note that current block = latestBlock + 1, so latestBlock + 2 is in the future
            await expectThrow(roundsManager.blockHash(latestBlock + 2))
        })

        it("should fail if the current block >= 256 and the block is more than 256 blocks in the past", async () => {
            await fixture.rpc.wait(256)

            const latestBlock = web3.eth.blockNumber
            // Note that current block = latestBlock + 1, so latestBlock - 256 = current block - 257
            await expectThrow(roundsManager.blockHash(latestBlock - 256))
        })

        it("should fail if block is the current block", async () => {
            const latestBlock = web3.eth.blockNumber
            // Note that current block = latestBlock + 1
            await expectThrow(roundsManager.blockHash(latestBlock + 1))
        })

        it("should return the block hash if the current block is >= 256 and the block is not more than 256 blocks in the past", async () => {
            await fixture.rpc.wait(256)

            const pastBlock = web3.eth.blockNumber - 1
            const pastBlockHash = web3.eth.getBlock(pastBlock).hash

            const blockHash = await roundsManager.blockHash(pastBlock)
            assert.equal(blockHash, pastBlockHash, "wrong block hash")
        })
    })

    describe("currentRound", () => {
        beforeEach(async () => {
            const roundLength = await roundsManager.roundLength.call()
            await fixture.rpc.waitUntilNextBlockMultiple(roundLength.toNumber())
        })

        it("should return the current round", async () => {
            const blockNum = web3.eth.blockNumber
            const roundLength = await roundsManager.roundLength.call()
            const expCurrentRound = Math.floor(blockNum / roundLength.toNumber())

            assert.equal(await roundsManager.currentRound(), expCurrentRound, "wrong current round")
        })

        it("should return the current round after roundLength was increased and there is a new round", async () => {
            const currentRound = await roundsManager.currentRound()

            await roundsManager.setRoundLength(60)
            await fixture.rpc.wait(60)

            assert.equal(await roundsManager.currentRound(), currentRound.toNumber() + 1, "wrong current round after roundLength increase and new round")
        })

        it("should return the current round after roundLength was increased but there are no new rounds yet", async () => {
            const currentRound = await roundsManager.currentRound()

            await roundsManager.setRoundLength(60)

            assert.equal(await roundsManager.currentRound(), currentRound.toNumber(), "wrong current round after roundLength increase and no new rounds")
        })

        it("should return the current round after roundLength was decreased and there is a new round", async () => {
            const currentRound = await roundsManager.currentRound()

            await roundsManager.setRoundLength(40)
            await fixture.rpc.wait(40)

            assert.equal(await roundsManager.currentRound(), currentRound.toNumber() + 1, "wrong current round after roundLength decrease and new round")
        })

        it("should return the current round after roundLength was decreased but there are no new rounds yet", async () => {
            const currentRound = await roundsManager.currentRound()

            await roundsManager.setRoundLength(40)

            assert.equal(await roundsManager.currentRound(), currentRound.toNumber(), "wrong current round after roundLength decrease and no new rounds")
        })
    })

    describe("currentRoundStartBlock", () => {
        beforeEach(async () => {
            const roundLength = await roundsManager.roundLength.call()
            await fixture.rpc.waitUntilNextBlockMultiple(roundLength.toNumber())
        })

        it("should return the start block of the current round", async () => {
            const blockNum = web3.eth.blockNumber
            const roundLength = await roundsManager.roundLength.call()
            const expStartBlock = Math.floor(blockNum / roundLength.toNumber()) * roundLength.toNumber()

            assert.equal(await roundsManager.currentRoundStartBlock(), expStartBlock, "current round start block is incorrect")
        })

        it("should return the start block of the current round after roundLength increase and there is a new round", async () => {
            const currentRoundStartBlock = await roundsManager.currentRoundStartBlock()

            await roundsManager.setRoundLength(60)
            await fixture.rpc.wait(60)

            assert.equal(await roundsManager.currentRoundStartBlock(), currentRoundStartBlock.toNumber() + 60, "wrong current round start block after roundLength increase and new round")
        })

        it("should return the start block of the current round after roundLength increase and there are no new rounds", async () => {
            const currentRoundStartBlock = await roundsManager.currentRoundStartBlock()

            await roundsManager.setRoundLength(60)

            assert.equal(await roundsManager.currentRoundStartBlock(), currentRoundStartBlock.toNumber(), "wrong current round start block after roundLength increase and no new rounds")
        })

        it("should return the start block of the current round after roundLength decrease and there is a new round", async () => {
            const currentRoundStartBlock = await roundsManager.currentRoundStartBlock()

            await roundsManager.setRoundLength(40)
            await fixture.rpc.wait(40)

            assert.equal(await roundsManager.currentRoundStartBlock(), currentRoundStartBlock.toNumber() + 40, "wrong current round start block after roundLength decrease and new round")
        })

        it("should return the start block of the current block after roundLength decrease and there are no new rounds", async () => {
            const currentRoundStartBlock = await roundsManager.currentRoundStartBlock()

            await roundsManager.setRoundLength(40)

            assert.equal(await roundsManager.currentRoundStartBlock(), currentRoundStartBlock.toNumber(), "wrong current round start block after roundLength decrease and no new rounds")
        })
    })

    describe("currentRoundInitialized", () => {
        beforeEach(async () => {
            const roundLength = await roundsManager.roundLength.call()
            await fixture.rpc.waitUntilNextBlockMultiple(roundLength.toNumber())
        })

        it("should return true if the current round is initialized", async () => {
            await roundsManager.initializeRound()

            assert.isOk(await roundsManager.currentRoundInitialized(), "not true when current round initialized")
        })

        it("should return false if the current round is not initialized", async () => {
            assert.isNotOk(await roundsManager.currentRoundInitialized(), "not false when current round not initialized")
        })
    })

    describe("currentRoundLocked", () => {
        let roundLength

        beforeEach(async () => {
            roundLength = await roundsManager.roundLength.call()
            await fixture.rpc.waitUntilNextBlockMultiple(roundLength.toNumber())
        })

        it("should return true if the current round is locked", async () => {
            const roundLockAmount = await roundsManager.roundLockAmount.call()
            const roundLockBlocks = roundLength.mul(roundLockAmount).div(PERC_DIVISOR).floor()
            await fixture.rpc.wait(roundLength.sub(roundLockBlocks).toNumber())

            assert.isOk(await roundsManager.currentRoundLocked(), "not true when in lock period")
        })

        it("should return false if the current round is not locked", async () => {
            assert.isNotOk(await roundsManager.currentRoundLocked(), "not false when not in lock period")
        })
    })
})
