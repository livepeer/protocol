import RPC from "../../utils/rpc"
import {contractId} from "../../utils/helpers"
import {constants} from "../../utils/constants"
import truffleAssert from "truffle-assertions"

const Controller = artifacts.require("Controller")
const BondingManager = artifacts.require("BondingManager")
const AdjustableRoundsManager = artifacts.require("AdjustableRoundsManager")
const LivepeerToken = artifacts.require("LivepeerToken")

contract("PoolUpdatesWithHints", accounts => {
    let rpc
    let snapshotId

    let controller
    let bondingManager
    let roundsManager
    let token

    let roundLength

    // Default active set size is 10
    const transcoders = accounts.slice(0, 10)
    const delegator = accounts[11]
    const newTranscoder = accounts[12]

    // Creates a full pool using the addresses in `accs`
    // Upon creation, the pool ordering (descending from first position) is:
    // (accs[0], accs.length) -> (accs[1], accs.length - 1) -> .. -> (accs[accs.length - 1], 1)
    const createFullPool = async accs => {
        let prevAcc = constants.NULL_ADDRESS
        let stake = accs.length
        for (let acc of accs) {
            await selfBond(acc, stake, prevAcc, constants.NULL_ADDRESS)
            prevAcc = acc
            stake--
        }

        await roundsManager.mineBlocks(roundLength.toNumber())
        await roundsManager.initializeRound()
    }

    const approve = async (delegator, amount) => {
        await token.transfer(delegator, amount)
        await token.approve(bondingManager.address, amount, {from: delegator})
    }

    const selfBond = async (delegator, amount, newPosPrev, newPosNext) => {
        await approve(delegator, amount)
        await bondingManager.bondWithHint(
            amount,
            delegator,
            constants.NULL_ADDRESS,
            constants.NULL_ADDRESS,
            newPosPrev,
            newPosNext,
            {from: delegator}
        )
    }

    const transcoderAtPoolPos = async pos => {
        const pool = await transcoderPool()
        return pool[pos]
    }

    const transcoderPool = async () => {
        let pool = []
        let tr = await bondingManager.getFirstTranscoderInPool()

        while (tr != constants.NULL_ADDRESS) {
            pool.push(tr)
            tr = await bondingManager.getNextTranscoderInPool(tr)
        }

        return pool
    }

    before(async () => {
        rpc = new RPC(web3)

        controller = await Controller.deployed()

        const bondingManagerAddr = await controller.getContract(contractId("BondingManager"))
        bondingManager = await BondingManager.at(bondingManagerAddr)

        const roundsManagerAddr = await controller.getContract(contractId("RoundsManager"))
        roundsManager = await AdjustableRoundsManager.at(roundsManagerAddr)

        const tokenAddr = await controller.getContract(contractId("LivepeerToken"))
        token = await LivepeerToken.at(tokenAddr)

        roundLength = await roundsManager.roundLength.call()

        await controller.unpause()

        await createFullPool(transcoders)
    })

    beforeEach(async () => {
        snapshotId = await rpc.snapshot()
    })

    afterEach(async () => {
        await rpc.revert(snapshotId)
    })

    it("initial transcoder pool order should be correct", async () => {
        const pool = await transcoderPool()

        for (let i = 0; i < transcoders.length; i++) {
            assert.equal(pool[i], transcoders[i])
        }
    })

    it("transcoder calls reward with hint", async () => {
        // All transcoders call reward() except for the last one
        const size = transcoders.length - 1
        const rewardTranscoders = transcoders.slice(0, size - 1)
        for (let tr of rewardTranscoders) {
            await bondingManager.reward({from: tr})
        }

        let testSnapshotId = await rpc.snapshot()

        // Get gas cost of reward()
        const txResRewardNoHint = await bondingManager.reward({from: transcoders[size - 1]})
        assert.equal(await transcoderAtPoolPos(size - 1), transcoders[size - 1])

        await rpc.revert(testSnapshotId)

        // Get gas cost rewardWithHint()
        const txResRewardHint = await bondingManager.rewardWithHint(transcoders[size - 2], constants.NULL_ADDRESS, {from: transcoders[size - 1]})
        assert.equal(await transcoderAtPoolPos(size - 1), transcoders[size - 1])

        // Gas cost of rewardWithHint() should be less than gas cost of reward()
        assert.isBelow(txResRewardHint.receipt.gasUsed, txResRewardNoHint.receipt.gasUsed)
    })

    it("new transcoder joins the pool", async () => {
        const size = transcoders.length
        await approve(transcoders[size - 2], 1)
        await bondingManager.bond(1, transcoders[size - 2], {from: transcoders[size - 2]})
        await approve(transcoders[size - 1], 1)
        await bondingManager.bond(1, transcoders[size - 1], {from: transcoders[size - 1]})

        // Not enough stake to join pool
        await approve(newTranscoder, 2)
        await bondingManager.bond(2, newTranscoder, {from: newTranscoder})

        // After this tx, the new transcoder should have enough stake to join pool
        await bondingManager.unbond(1, {from: transcoders[size - 1]})

        let testSnapshotId = await rpc.snapshot()

        // Pool ordering (descending)
        // (transcoders[size - 4], 4) -> (transcoders[size - 2], 3) -> (transcoders[size - 3], 3) -> (transcoders[size - 1], 2)

        // Get gas cost of transcoder()
        const txResNoHint = await bondingManager.transcoder(0, 0, {from: newTranscoder})
        assert.equal(await transcoderAtPoolPos(size - 1), newTranscoder)
        truffleAssert.eventEmitted(txResNoHint, "TranscoderDeactivated", e => e.transcoder == transcoders[size - 1])

        await rpc.revert(testSnapshotId)

        // Get gas cost of transcoderWithHint()
        const txResHint = await bondingManager.transcoderWithHint(0, 0, transcoders[size - 3], constants.NULL_ADDRESS, {from: newTranscoder})
        assert.equal(await transcoderAtPoolPos(size - 1), newTranscoder)
        truffleAssert.eventEmitted(txResHint, "TranscoderDeactivated", e => e.transcoder == transcoders[size - 1])

        // Gas cost of transcoderWithHint() should be less than gas cost of transcoder()
        assert.isBelow(txResHint.receipt.gasUsed, txResNoHint.receipt.gasUsed)
    })

    it("delegator bonds with hint", async () => {
        const size = transcoders.length
        await approve(delegator, 1)

        let testSnapshotId = await rpc.snapshot()

        // Pool ordering (descending)
        // (transcoders[size - 4], 4) -> (transcoders[size - 3], 3) -> (transcoders[size - 2], 2) -> (transcoders[size - 1], 1)

        // Get gas cost of bond()
        const txResNoHint = await bondingManager.bond(1, transcoders[size - 2], {from: delegator})
        // transcoders[size - 2] should have moved up one position
        assert.equal(await transcoderAtPoolPos(size - 3), transcoders[size - 2])

        await rpc.revert(testSnapshotId)

        // Get gas cost of bondWithHint()
        const txResHint = await bondingManager.bondWithHint(
            1,
            transcoders[size - 2],
            constants.NULL_ADDRESS,
            constants.NULL_ADDRESS,
            transcoders[size - 4],
            transcoders[size - 3],
            {from: delegator}
        )
        // transcoders[size - 2] should have moved up one position
        assert.equal(await transcoderAtPoolPos(size - 3), transcoders[size - 2])

        // Gas cost of bondWithHint() should be less than gas cost of bond()
        assert.isBelow(txResHint.receipt.gasUsed, txResNoHint.receipt.gasUsed)
    })

    it("delegator changes delegation with hint", async () => {
        const size = transcoders.length
        await approve(delegator, 1)
        await bondingManager.bond(1, transcoders[size - 2], {from: delegator})

        let testSnapshotId = await rpc.snapshot()

        // Pool ordering (descending)
        // Before:
        // (transcoders[size - 4], 4) -> (transcoders[size - 2], 3) -> (transcoders[size - 3], 3) -> (transcoders[size - 1], 1)
        // After (expected):
        // (transcoders[size - 4], 4) -> (transcoders[size - 3], 3) -> (transcoders[size - 1], 2) -> (transcoders[size - 2], 2)

        // Get gas cost of bond()
        const txResNoHint = await bondingManager.bond(0, transcoders[size - 1], {from: delegator})
        assert.equal(await transcoderAtPoolPos(size - 1), transcoders[size - 2])
        assert.equal(await transcoderAtPoolPos(size - 2), transcoders[size - 1])

        await rpc.revert(testSnapshotId)

        // Get gas cost of bondWithHint()
        const txResHint = await bondingManager.bondWithHint(
            0,
            transcoders[size - 1],
            transcoders[size - 3],
            transcoders[size - 1],
            transcoders[size - 3],
            transcoders[size - 2],
            {from: delegator}
        )
        assert.equal(await transcoderAtPoolPos(size - 1), transcoders[size - 2])
        assert.equal(await transcoderAtPoolPos(size - 2), transcoders[size - 1])

        // Gas cost of bondWithHint() should be less than gas cost of bond()
        assert.isBelow(txResHint.receipt.gasUsed, txResNoHint.receipt.gasUsed)
    })

    it("transcoder partially unbonds and rebonds", async () => {
        const size = transcoders.length

        let testSnapshotId = await rpc.snapshot()

        // Pool ordering (descending)
        // Before:
        // (transcoders[size - 4], 4) -> (transcoders[size - 3], 3) -> (transcoders[size - 2], 2) -> (transcoders[size - 1], 1)

        const txResUnbondNoHint = await bondingManager.unbond(2, {from: transcoders[size - 4]})
        // Should have dropped 1 position
        assert.equal(await transcoderAtPoolPos(size - 3), transcoders[size - 4])
        const txResRebondNoHint = await bondingManager.rebond(0, {from: transcoders[size - 4]})
        // Should have gained 1 position
        assert.equal(await transcoderAtPoolPos(size - 4), transcoders[size - 4])

        await rpc.revert(testSnapshotId)

        const txResUnbondHint = await bondingManager.unbondWithHint(2, transcoders[size - 3], transcoders[size - 2], {from: transcoders[size - 4]})
        // Should have dropped 1 position
        assert.equal(await transcoderAtPoolPos(size - 3), transcoders[size - 4])
        const txResRebondHint = await bondingManager.rebondWithHint(0, transcoders[size - 5], transcoders[size - 3], {from: transcoders[size - 4]})
        // Should have gained 1 position
        assert.equal(await transcoderAtPoolPos(size - 4), transcoders[size - 4])

        assert.isBelow(txResUnbondHint.receipt.gasUsed, txResUnbondNoHint.receipt.gasUsed)
        assert.isBelow(txResRebondHint.receipt.gasUsed, txResRebondNoHint.receipt.gasUsed)
    })

    it("transcoder rebonds from unbonded", async () => {
        const size = transcoders.length
        await bondingManager.unbond(4, {from: transcoders[size - 4]})

        let testSnapshotId = await rpc.snapshot()

        // Pool ordering (descending)
        // Before:
        // (transcoders[size - 3], 3) -> (transcoders[size - 2], 2) -> (transcoders[size - 1], 1)
        // After (expected):
        // (transcoders[size - 4], 4) -> (transcoders[size - 3], 3) -> (transcoders[size - 2], 2) -> (transcoders[size - 1], 1)

        const txResRebondNoHint = await bondingManager.rebondFromUnbonded(transcoders[size - 4], 0, {from: transcoders[size - 4]})
        assert.equal(await transcoderAtPoolPos(size - 4), transcoders[size - 4])

        await rpc.revert(testSnapshotId)

        const txResRebondHint = await bondingManager.rebondFromUnbondedWithHint(
            transcoders[size - 4],
            0,
            transcoders[size - 5],
            transcoders[size - 3],
            {from: transcoders[size - 4]}
        )
        assert.equal(await transcoderAtPoolPos(size - 4), transcoders[size - 4])

        assert.isBelow(txResRebondHint.receipt.gasUsed, txResRebondNoHint.receipt.gasUsed)
    })
})
