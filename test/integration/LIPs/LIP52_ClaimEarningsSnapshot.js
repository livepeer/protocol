import {contractId} from "../../../utils/helpers"
import {constants} from "../../../utils/constants"
const {MerkleTree} = require("../../../utils/merkleTree")
const executeLIP36Upgrade = require("../../helpers/executeLIP36Upgrade")

import {createWinningTicket, getTicketHash} from "../../helpers/ticket"
import signMsg from "../../helpers/signMsg"

const {keccak256, bufferToHex} = require("ethereumjs-util")
let abi = require("ethereumjs-abi")
import BN from "bn.js"
import truffleAssert from "truffle-assertions"
import {assert} from "chai"

const Controller = artifacts.require("Controller")
const BondingManager = artifacts.require("BondingManager")
const AdjustableRoundsManager = artifacts.require("AdjustableRoundsManager")
const LivepeerToken = artifacts.require("LivepeerToken")
const TicketBroker = artifacts.require("TicketBroker")
const MerkleSnapshot = artifacts.require("MerkleSnapshot")
const BondingManagerPreLIP36 = artifacts.require("BondingManagerPreLIP36")
const LinkedList = artifacts.require("SortedDoublyLL")
const ManagerProxy = artifacts.require("ManagerProxy")

contract("ClaimEarningsSnapshot", accounts => {
    let controller
    let bondingManager
    let roundsManager
    let token
    let broker
    let snapshots
    let bondingProxy

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
    const transcoder3 = accounts[3]

    const delegate1 = accounts[4]
    const delegate2 = accounts[5]
    const delegate3 = accounts[6]
    const delegate4 = accounts[7]
    const delegate5 = accounts[8]
    const delegate6 = accounts[9]

    const broadcaster = accounts[10]

    const transcoders = [transcoder1, transcoder2, transcoder3]
    const delegates = [delegate1, delegate2, delegate3, delegate4, delegate5, delegate6]

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

        const ll = await LinkedList.new()
        BondingManagerPreLIP36.link("SortedDoublyLL", ll.address)
        const bondingTarget = await BondingManagerPreLIP36.new(controller.address)
        await controller.setContractInfo(contractId("BondingManagerTarget"), bondingTarget.address, web3.utils.asciiToHex("0x123"))
        bondingProxy = await ManagerProxy.new(controller.address, contractId("BondingManagerTarget"))
        await controller.setContractInfo(contractId("BondingManager"), bondingProxy.address, web3.utils.asciiToHex("0x123"))
        bondingManager = await BondingManagerPreLIP36.at(bondingProxy.address)

        await bondingManager.setUnbondingPeriod(UNBONDING_PERIOD)
        await bondingManager.setNumActiveTranscoders(NUM_ACTIVE_TRANSCODERS)
        await bondingManager.setMaxEarningsClaimsRounds(MAX_EARNINGS_CLAIMS_ROUNDS)

        const bondingManagerAddr = await controller.getContract(contractId("BondingManager"))
        bondingManager = await BondingManager.at(bondingManagerAddr)

        const roundsManagerAddr = await controller.getContract(contractId("RoundsManager"))
        roundsManager = await AdjustableRoundsManager.at(roundsManagerAddr)

        const tokenAddr = await controller.getContract(contractId("LivepeerToken"))
        token = await LivepeerToken.at(tokenAddr)

        const brokerAddr = await controller.getContract(contractId("JobsManager"))
        broker = await TicketBroker.at(brokerAddr)

        // deploy MerkleSnapshot contract
        snapshots = await MerkleSnapshot.new(controller.address)
        await controller.setContractInfo(contractId("MerkleSnapshot"), snapshots.address, web3.utils.asciiToHex("0x123"))

        // transcoder start stake = 100 LPT
        await Promise.all(transcoders.map(t => token.transfer(t, transferAmount, {from: accounts[0]})))
        // delegate start stake = 50 LPT
        await Promise.all(delegates.map(d => token.transfer(d, transferAmount.div(new BN(2)), {from: accounts[0]})))

        roundLength = await roundsManager.roundLength.call()
        await roundsManager.mineBlocks(roundLength.toNumber() * 1)
        await roundsManager.initializeRound()

        // approve LPT for bonding
        await Promise.all(transcoders.map(t => token.approve(bondingManager.address, transferAmount, {from: t})))
        await Promise.all(delegates.map(d => token.approve(bondingManager.address, transferAmount.div(new BN(2)), {from: d})))

        // bond and register transcoders
        await Promise.all(transcoders.map(t => bondingManager.bond(transferAmount, t, {from: t})))
        await Promise.all(transcoders.map(t => {
            let rewardCut = Math.floor(Math.random() * 100) * constants.PERC_MULTIPLIER
            let feeShare = Math.floor(Math.random() * 100) * constants.PERC_MULTIPLIER
            bondingManager.transcoder(rewardCut, feeShare, {from: t})
        }))

        // delegate to transcoders
        await Promise.all(delegates.map((d, i) => bondingManager.bond(transferAmount.div(new BN(2)), transcoders[i % transcoders.length], {from: d})))

        // Deposit funds for broadcaster
        await broker.fundDepositAndReserve(
            deposit,
            reserve,
            {from: broadcaster, value: deposit.add(reserve)}
        )

        // init new round
        await roundsManager.mineBlocks(roundLength.toNumber())
        await roundsManager.setBlockHash(web3.utils.keccak256("foo"))
        await roundsManager.initializeRound()
    })

    describe("Initial stakes", () => {
        it("checks that transcoders are bonded", async () => {
            let dels = await Promise.all(transcoders.map(t => bondingManager.getDelegator(t)))
            dels.forEach(d => assert.isTrue(d.bondedAmount.cmp(transferAmount) == 0))
        })

        it("checks that delegators are bonded", async () => {
            let dels = await Promise.all(delegates.map(d => bondingManager.getDelegator(d)))
            dels.forEach(d => assert.isTrue(d.bondedAmount.cmp(transferAmount.div(new BN(2))) == 0))
        })
    })

    describe("ClaimSnapshotEarnings", () => {
        let elements = []
        let tree
        const id = bufferToHex(keccak256("LIP-52"))
        before(async () => {
            for (let i = 0; i < 10; i++) {
                await Promise.all(transcoders.map(t => bondingManager.reward({from: t})))
                await Promise.all(transcoders.map(t => redeemWinningTicket(t, broadcaster, faceValue)))
                await roundsManager.mineBlocks(roundLength.toNumber() * 5)
                await roundsManager.setBlockHash(web3.utils.keccak256("foo"))
                await roundsManager.initializeRound()
            }

            // Set LIP-52 upgrade round
            const currentRound = await roundsManager.currentRound()
            await roundsManager.setLIPUpgradeRound(52, currentRound)

            transcoders.forEach(t => {
                elements.push({address: t})
            })
            delegates.forEach(d => {
                elements.push({address: d})
            })

            const leaves = []
            for (let el of elements) {
                el["pendingStake"] = await bondingManager.pendingStake(el.address, currentRound)
                el["pendingFees"] = await bondingManager.pendingFees(el.address, currentRound)
                leaves.push(abi.rawEncode(["address", "uint256", "uint256"], [el.address, el.pendingStake, el.pendingFees]))
            }

            tree = new MerkleTree(leaves)
        })

        it("sets the snapshot root", async () => {
            const root = tree.getHexRoot()
            await snapshots.setSnapshot(
                id,
                root
            )

            assert.equal(
                await snapshots.snapshot(id),
                root
            )
        })

        it("Succesfully verifies the merkle proofs for each delegate", async () => {
            for (let el of elements) {
                const leaf = abi.rawEncode(["address", "uint256", "uint256"], [el.address, el.pendingStake, el.pendingFees])
                const proof = tree.getHexProof(leaf)
                assert.isTrue(await snapshots.verify(id, proof, keccak256(leaf)))
            }
        })

        it("succesfully calls claimSnapShotEarnings and unbond as arbitrary call using the 'data' field for each delegate", async () => {
            bondingManager = await executeLIP36Upgrade(controller, roundsManager, bondingProxy.address)

            await roundsManager.mineBlocks(roundLength.toNumber() * 5)
            await roundsManager.initializeRound()

            const endRound = await roundsManager.lipUpgradeRound(52)
            const currentRound = await roundsManager.currentRound()

            for (let el of elements) {
                const delegatorBefore = await bondingManager.getDelegator(el.address)
                const pendingStakeBefore = await bondingManager.pendingStake(el.address, currentRound)
                const pendingFeesBefore = await bondingManager.pendingFees(el.address, currentRound)

                assert.equal(pendingStakeBefore.toString(), el.pendingStake.toString())
                assert.equal(pendingFeesBefore.toString(), el.pendingFees.toString())

                // unbond for initial bonding amount after claiming snapshot earnings
                const data = bondingManager.contract.methods.unbond(delegatorBefore.bondedAmount.toString()).encodeABI()
                const leaf = abi.rawEncode(["address", "uint256", "uint256"], [el.address, el.pendingStake, el.pendingFees])
                const proof = tree.getHexProof(leaf)
                const tx = await bondingManager.claimSnapshotEarnings(el.pendingStake, el.pendingFees, proof, data, {from: el.address})

                const delegatorAfter = await bondingManager.getDelegator(el.address)

                assert.isTrue(delegatorAfter.lastClaimRound.cmp(currentRound) == 0, "last claim round not correct")
                assert.isTrue(pendingStakeBefore.sub(delegatorBefore.bondedAmount).cmp(delegatorAfter.bondedAmount) == 0, "bonded amount not updated after claiming")
                assert.isTrue(pendingFeesBefore.cmp(delegatorAfter.fees) == 0, "fees not correctly updated after claiming")

                // check emitted event
                truffleAssert.eventEmitted(
                    tx,
                    "EarningsClaimed",
                    e => e.delegate == delegatorBefore.delegateAddress
                    && e.delegator == el.address
                    && e.rewards == delegatorAfter.bondedAmount.toString() // bondedAFter + bondedBefore (unbonded after  call) - bondedbefore = bondedAfter
                    && e.fees == delegatorAfter.fees.sub(delegatorBefore.fees).toString()
                    && e.endRound == endRound.toString()
                    && e.startRound == delegatorBefore.lastClaimRound.add(new BN(1)).toString()
                )
            }
        })
    })
})

contract("Including cumulative earnings in the snapshot results in excessive earnings (bug)", accounts => {
    let controller
    let bondingManager
    let roundsManager
    let token
    let snapshots
    let bondingProxy

    let roundLength

    const transcoder = accounts[0]


    const NUM_ACTIVE_TRANSCODERS = 10
    const UNBONDING_PERIOD = 2
    const MAX_EARNINGS_CLAIMS_ROUNDS = 20
    const transferAmount = (new BN(100)).mul(constants.TOKEN_UNIT)

    let leaf
    let proof

    before(async () => {
        controller = await Controller.deployed()
        await controller.unpause()

        const ll = await LinkedList.new()
        BondingManagerPreLIP36.link("SortedDoublyLL", ll.address)
        const bondingTarget = await BondingManagerPreLIP36.new(controller.address)
        await controller.setContractInfo(contractId("BondingManagerTarget"), bondingTarget.address, web3.utils.asciiToHex("0x123"))
        bondingProxy = await ManagerProxy.new(controller.address, contractId("BondingManagerTarget"))
        await controller.setContractInfo(contractId("BondingManager"), bondingProxy.address, web3.utils.asciiToHex("0x123"))
        bondingManager = await BondingManagerPreLIP36.at(bondingProxy.address)

        await bondingManager.setUnbondingPeriod(UNBONDING_PERIOD)
        await bondingManager.setNumActiveTranscoders(NUM_ACTIVE_TRANSCODERS)
        await bondingManager.setMaxEarningsClaimsRounds(MAX_EARNINGS_CLAIMS_ROUNDS)

        const bondingManagerAddr = await controller.getContract(contractId("BondingManager"))
        bondingManager = await BondingManager.at(bondingManagerAddr)

        const roundsManagerAddr = await controller.getContract(contractId("RoundsManager"))
        roundsManager = await AdjustableRoundsManager.at(roundsManagerAddr)

        const tokenAddr = await controller.getContract(contractId("LivepeerToken"))
        token = await LivepeerToken.at(tokenAddr)

        // deploy MerkleSnapshot contract
        snapshots = await MerkleSnapshot.new(controller.address)
        await controller.setContractInfo(contractId("MerkleSnapshot"), snapshots.address, web3.utils.asciiToHex("0x123"))

        roundLength = await roundsManager.roundLength.call()
        await roundsManager.mineBlocks(roundLength.toNumber() * 1)
        await roundsManager.initializeRound()

        await token.approve(bondingManager.address, transferAmount)
        await bondingManager.bond(transferAmount, transcoder)

        let rewardCut = 50 * constants.PERC_MULTIPLIER
        let feeShare = 50 * constants.PERC_MULTIPLIER
        bondingManager.transcoder(rewardCut, feeShare)

        await roundsManager.mineBlocks(roundLength.toNumber() * 1)
        await roundsManager.setBlockHash(web3.utils.keccak256("foo"))
        await roundsManager.initializeRound()
    })

    describe("set snapshot", () => {
        let elements = [{address: transcoder}]
        let tree
        const id = bufferToHex(keccak256("LIP-52"))
        before(async () => {
            for (let i = 0; i < 10; i++) {
                await bondingManager.reward()
                await roundsManager.mineBlocks(roundLength.toNumber() * 1)
                await roundsManager.setBlockHash(web3.utils.keccak256("foo"))
                await roundsManager.initializeRound()
            }

            bondingManager = await executeLIP36Upgrade(controller, roundsManager, bondingProxy.address)

            await bondingManager.reward()
            await roundsManager.mineBlocks(roundLength.toNumber() * 1)
            await roundsManager.setBlockHash(web3.utils.keccak256("foo"))
            await roundsManager.initializeRound()

            const currentRound = await roundsManager.currentRound()

            const leaves = []
            for (let el of elements) {
                el["pendingStake"] = await bondingManager.pendingStake(el.address, currentRound)
                el["pendingFees"] = await bondingManager.pendingFees(el.address, currentRound)
                leaves.push(abi.rawEncode(["address", "uint256", "uint256"], [el.address, el.pendingStake, el.pendingFees]))
            }

            tree = new MerkleTree(leaves)
        })


        it("checks that transcoder is bonded", async () => {
            assert.isTrue((await bondingManager.getDelegator(transcoder)).bondedAmount.cmp(transferAmount) == 0)
        })


        it("sets the snapshot root", async () => {
            const root = tree.getHexRoot()
            await snapshots.setSnapshot(
                id,
                root
            )

            assert.equal(
                await snapshots.snapshot(id),
                root
            )
        })

        it("Succesfully verifies the merkle proofs for the transcoder", async () => {
            for (let el of elements) {
                leaf = abi.rawEncode(["address", "uint256", "uint256"], [el.address, el.pendingStake, el.pendingFees])
                proof = tree.getHexProof(leaf)
                assert.isTrue(await snapshots.verify(id, proof, keccak256(leaf)))
            }
        })
    })

    describe("Snapshot includes cumulative earnings", async () => {
        before(async () => {
            const lip36Round = await roundsManager.lipUpgradeRound(36)
            await roundsManager.setLIPUpgradeRound(52, lip36Round)
        })

        it("there should be residual rewards (this is a bug)", async () => {
            const currentRound = await roundsManager.currentRound()

            const pendingStake = await bondingManager.pendingStake(transcoder, currentRound)
            const data = bondingManager.contract.methods.unbond(pendingStake.toString()).encodeABI()
            await bondingManager.claimSnapshotEarnings(pendingStake, new BN(0), proof, data)

            const delegatorAfter = await bondingManager.getDelegator(transcoder)

            assert.isTrue(delegatorAfter.lastClaimRound.cmp(currentRound) == 0, "last claim round not correct")
            assert.isTrue(delegatorAfter.bondedAmount.toString() != "0", "bonded amount not greater than 0")
        })
    })
})

contract("Snapshot only existing out of pre-LIP36 earnings should yield correct results", accounts => {
    let controller
    let bondingManager
    let roundsManager
    let token
    let snapshots
    let bondingProxy

    let roundLength

    const transcoder = accounts[0]

    const NUM_ACTIVE_TRANSCODERS = 10
    const UNBONDING_PERIOD = 2
    const MAX_EARNINGS_CLAIMS_ROUNDS = 20
    const transferAmount = (new BN(100)).mul(constants.TOKEN_UNIT)

    let leaf
    let proof
    let elements = [{address: transcoder}]
    let tree

    before(async () => {
        controller = await Controller.deployed()
        await controller.unpause()

        const ll = await LinkedList.new()
        BondingManagerPreLIP36.link("SortedDoublyLL", ll.address)
        const bondingTarget = await BondingManagerPreLIP36.new(controller.address)
        await controller.setContractInfo(contractId("BondingManagerTarget"), bondingTarget.address, web3.utils.asciiToHex("0x123"))
        bondingProxy = await ManagerProxy.new(controller.address, contractId("BondingManagerTarget"))
        await controller.setContractInfo(contractId("BondingManager"), bondingProxy.address, web3.utils.asciiToHex("0x123"))
        bondingManager = await BondingManagerPreLIP36.at(bondingProxy.address)

        await bondingManager.setUnbondingPeriod(UNBONDING_PERIOD)
        await bondingManager.setNumActiveTranscoders(NUM_ACTIVE_TRANSCODERS)
        await bondingManager.setMaxEarningsClaimsRounds(MAX_EARNINGS_CLAIMS_ROUNDS)

        const bondingManagerAddr = await controller.getContract(contractId("BondingManager"))
        bondingManager = await BondingManager.at(bondingManagerAddr)

        const roundsManagerAddr = await controller.getContract(contractId("RoundsManager"))
        roundsManager = await AdjustableRoundsManager.at(roundsManagerAddr)

        const tokenAddr = await controller.getContract(contractId("LivepeerToken"))
        token = await LivepeerToken.at(tokenAddr)

        // deploy MerkleSnapshot contract
        snapshots = await MerkleSnapshot.new(controller.address)
        await controller.setContractInfo(contractId("MerkleSnapshot"), snapshots.address, web3.utils.asciiToHex("0x123"))

        roundLength = await roundsManager.roundLength.call()
        await roundsManager.mineBlocks(roundLength.toNumber() * 1)
        await roundsManager.initializeRound()

        await token.approve(bondingManager.address, transferAmount)
        await bondingManager.bond(transferAmount, transcoder)

        let rewardCut = 50 * constants.PERC_MULTIPLIER
        let feeShare = 50 * constants.PERC_MULTIPLIER
        bondingManager.transcoder(rewardCut, feeShare)

        await roundsManager.mineBlocks(roundLength.toNumber() * 1)
        await roundsManager.setBlockHash(web3.utils.keccak256("foo"))
        await roundsManager.initializeRound()
    })

    describe("set snapshot", () => {
        const id = bufferToHex(keccak256("LIP-52"))
        before(async () => {
            for (let i = 0; i < 10; i++) {
                await bondingManager.reward()
                await roundsManager.mineBlocks(roundLength.toNumber() * 1)
                await roundsManager.setBlockHash(web3.utils.keccak256("foo"))
                await roundsManager.initializeRound()
            }

            const snapshotRound = (await roundsManager.currentRound()).sub(new BN(1))

            bondingManager = await executeLIP36Upgrade(controller, roundsManager, bondingProxy.address)

            await bondingManager.reward()
            await roundsManager.mineBlocks(roundLength.toNumber() * 1)
            await roundsManager.setBlockHash(web3.utils.keccak256("foo"))
            await roundsManager.initializeRound()

            const leaves = []
            for (let el of elements) {
                el["pendingStake"] = await bondingManager.pendingStake(el.address, snapshotRound)
                el["pendingFees"] = await bondingManager.pendingFees(el.address, snapshotRound)
                leaves.push(abi.rawEncode(["address", "uint256", "uint256"], [el.address, el.pendingStake, el.pendingFees]))
            }

            tree = new MerkleTree(leaves)
        })


        it("checks that transcoder is bonded", async () => {
            assert.isTrue((await bondingManager.getDelegator(transcoder)).bondedAmount.cmp(transferAmount) == 0)
        })


        it("sets the snapshot root", async () => {
            const root = tree.getHexRoot()
            await snapshots.setSnapshot(
                id,
                root
            )

            assert.equal(
                await snapshots.snapshot(id),
                root
            )
        })

        it("Succesfully verifies the merkle proofs for the transcoder", async () => {
            for (let el of elements) {
                leaf = abi.rawEncode(["address", "uint256", "uint256"], [el.address, el.pendingStake, el.pendingFees])
                proof = tree.getHexProof(leaf)
                assert.isTrue(await snapshots.verify(id, proof, keccak256(leaf)))
            }
        })
    })

    describe("No cumulative snapshot earnings", async () => {
        before(async () => {
            const lip36Round = await roundsManager.lipUpgradeRound(36)
            await roundsManager.setLIPUpgradeRound(52, lip36Round.sub(new BN(1)))
        })

        it("should claim all pending rewards", async () => {
            const currentRound = await roundsManager.currentRound()

            const pendingStake = await bondingManager.pendingStake(transcoder, currentRound)
            const data = bondingManager.contract.methods.unbond(pendingStake.toString()).encodeABI()
            await bondingManager.claimSnapshotEarnings(elements[0].pendingStake, new BN(0), proof, data)

            const delegatorAfter = await bondingManager.getDelegator(transcoder)

            assert.isTrue(delegatorAfter.lastClaimRound.cmp(currentRound) == 0, "last claim round not correct")
            assert.isTrue(delegatorAfter.bondedAmount.toString() == "0", "bonded amount not 0")
        })
    })
})
