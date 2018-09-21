import {contractId} from "../../utils/helpers"
import batchTranscodeReceiptHashes from "../../utils/batchTranscodeReceipts"
import MerkleTree from "../../utils/merkleTree"
import {createTranscodingOptions} from "../../utils/videoProfile"
import Segment from "../../utils/segment"
import BigNumber from "bignumber.js"

const Controller = artifacts.require("Controller")
const BondingManager = artifacts.require("BondingManager")
const JobsManager = artifacts.require("JobsManager")
const AdjustableRoundsManager = artifacts.require("AdjustableRoundsManager")
const LivepeerToken = artifacts.require("LivepeerToken")

contract("DoubleClaimSegmentSlashing", accounts => {
    const TOKEN_UNIT = 10 ** 18

    let controller
    let bondingManager
    let roundsManager
    let jobsManager
    let token

    let transcoder
    let delegator1
    let delegator2
    let watcher
    let broadcaster

    let roundLength

    before(async () => {
        transcoder = accounts[0]
        delegator1 = accounts[1]
        delegator2 = accounts[2]
        watcher = accounts[3]
        broadcaster = accounts[3]

        controller = await Controller.deployed()
        await controller.unpause()

        const bondingManagerAddr = await controller.getContract(contractId("BondingManager"))
        bondingManager = await BondingManager.at(bondingManagerAddr)

        const roundsManagerAddr = await controller.getContract(contractId("RoundsManager"))
        roundsManager = await AdjustableRoundsManager.at(roundsManagerAddr)

        const jobsManagerAddr = await controller.getContract(contractId("JobsManager"))
        jobsManager = await JobsManager.at(jobsManagerAddr)

        // Set verification rate to 1 out of 1 segments, so every segment is challenged
        await jobsManager.setVerificationRate(1)
        // Set double claim segment slash amount to 20%
        await jobsManager.setDoubleClaimSegmentSlashAmount(200000)

        const tokenAddr = await controller.getContract(contractId("LivepeerToken"))
        token = await LivepeerToken.at(tokenAddr)

        const transferAmount = new BigNumber(10).times(TOKEN_UNIT)
        await token.transfer(transcoder, transferAmount, {from: accounts[0]})
        await token.transfer(delegator1, transferAmount, {from: accounts[0]})
        await token.transfer(delegator2, transferAmount, {from: accounts[0]})

        roundLength = await roundsManager.roundLength.call()
        await roundsManager.mineBlocks(roundLength.toNumber() * 1000)
        await roundsManager.initializeRound()

        await token.approve(bondingManager.address, 1000, {from: transcoder})
        await bondingManager.bond(1000, transcoder, {from: transcoder})
        await bondingManager.transcoder(10, 5, 1, {from: transcoder})

        await token.approve(bondingManager.address, 1000, {from: delegator1})
        await bondingManager.bond(1000, transcoder, {from: delegator1})

        await token.approve(bondingManager.address, 1000, {from: delegator2})
        await bondingManager.bond(1000, transcoder, {from: delegator2})

        // Fast forward to new round with locked in active transcoder set
        await roundsManager.mineBlocks(roundLength.toNumber())
        await roundsManager.initializeRound()
    })

    it("watcher should slash a transcoder for double claiming segments", async () => {
        await jobsManager.deposit({from: broadcaster, value: 1000})

        const endBlock = (await roundsManager.blockNum()).add(100)
        await jobsManager.job("foo", createTranscodingOptions(["foo", "bar"]), 1, endBlock, {from: broadcaster})

        let rand = web3.eth.getBlock(web3.eth.blockNumber).hash
        await roundsManager.mineBlocks(1)
        await roundsManager.setBlockHash(rand)

        // Segment data hashes
        const dataHashes = [
            "0x80084bf2fba02475726feb2cab2d8215eab14bc6bdd8bfb2c8151257032ecd8b",
            "0xb039179a8a4ce2c252aa6f2f25798251c19b75fc1508d9d511a191e0487d64a7",
            "0x263ab762270d3b73d3e2cddf9acc893bb6bd41110347e5d5e4bd1d3c128ea90a",
            "0x4ce8765e720c576f6f5a34ca380b3de5f0912e6e3cc5355542c363891e54594b"
        ]

        // Segments
        const segments = dataHashes.map((dataHash, idx) => new Segment("foo", idx, dataHash, broadcaster))

        // Transcoded data hashes
        const tDataHashes = [
            "0x42538602949f370aa331d2c07a1ee7ff26caac9cc676288f94b82eb2188b8465",
            "0xa0b37b8bfae8e71330bd8e278e4a45ca916d00475dd8b85e9352533454c9fec8",
            "0x9f2898da52dedaca29f05bcac0c8e43e4b9f7cb5707c14cc3f35a567232cec7c",
            "0x5a082c81a7e4d5833ee20bd67d2f4d736f679da33e4bebd3838217cb27bec1d3"
        ]

        // Transcode receipts
        const tReceiptHashes = batchTranscodeReceiptHashes(segments, tDataHashes)

        // Build merkle tree
        const merkleTree = new MerkleTree(tReceiptHashes)

        const tokenStartSupply = await token.totalSupply.call()

        // Transcoder claims segments 0 through 3
        await jobsManager.claimWork(0, [0, 3], merkleTree.getHexRoot(), {from: transcoder})
        // Transcoder claims segments 0 through 3 again
        await jobsManager.claimWork(0, [0, 3], merkleTree.getHexRoot(), {from: transcoder})
        // Wait for claims to be mined
        await roundsManager.mineBlocks(2)

        // Watcher slashes transcoder for double claiming segments
        // Transcoder claimed segments 0 through 3 twice
        await jobsManager.doubleClaimSegmentSlash(0, 0, 1, 0, {from: watcher})

        // Check that the transcoder is penalized
        const currentRound = await roundsManager.currentRound()
        const doubleClaimSegmentSlashAmount = await jobsManager.doubleClaimSegmentSlashAmount.call()
        const penalty = Math.floor((1000 * doubleClaimSegmentSlashAmount.toNumber()) / 1000000)
        const expTransStakeRemaining = 1000 - penalty
        const expDelegatedStakeRemaining = (1000 + 1000 + 1000) - penalty
        const expTotalBondedRemaining = 0
        const tokenEndSupply = await token.totalSupply.call()
        const finderFeeAmount = await jobsManager.finderFee.call()
        const finderFee = Math.floor((penalty * finderFeeAmount) / 1000000)
        const burned = tokenStartSupply.sub(tokenEndSupply).toNumber()
        const trans = await bondingManager.getDelegator(transcoder)

        assert.isNotOk(await bondingManager.isActiveTranscoder(transcoder, currentRound), "transcoder should be inactive")
        assert.equal(await bondingManager.transcoderStatus(transcoder), 0, "transcoder should not be registered")
        assert.equal(trans[0], expTransStakeRemaining, "wrong transcoder stake remaining")
        assert.equal(trans[3], expDelegatedStakeRemaining, "wrong delegated stake remaining")
        assert.equal(burned, penalty - finderFee, "wrong amount burned")

        // Check that the finder was rewarded
        assert.equal(await token.balanceOf(watcher), finderFee, "wrong finder fee")

        // Check that the broadcaster was refunded
        assert.equal((await jobsManager.getJob(0))[8], 0, "job escrow should be 0")
        assert.equal((await jobsManager.broadcasters.call(broadcaster))[0], 1000)

        // Check that the total stake for the round is updated
        // activeTranscoderSet.call(round) only returns the active stake and not the array of transcoder addresses
        // because Solidity does not return nested arrays in structs
        assert.equal(await bondingManager.activeTranscoderSet.call(currentRound), 0, "wrong active stake remaining")

        // Check that the total tokens bonded is updated
        assert.equal(await bondingManager.getTotalBonded(), expTotalBondedRemaining, "wrong total bonded amount")
    })
})
