import Fixture from "./helpers/Fixture"
import expectThrow from "../helpers/expectThrow"
import {contractId, functionSig, functionEncodedABI} from "../../utils/helpers"
import {constants} from "../../utils/constants"
import {createTranscodingOptions} from "../../utils/videoProfile"
import MerkleTree from "../../utils/merkleTree"
import Segment from "../../utils/segment"
import batchTranscodeReceiptHashes from "../../utils/batchTranscodeReceipts"
import ethUtil from "ethereumjs-util"

const JobsManager = artifacts.require("JobsManager")

contract("JobsManager", accounts => {
    let fixture
    let jobsManager

    const PERC_DIVISOR = 1000000
    const PERC_MULTIPLIER = PERC_DIVISOR / 100

    const VERIFICATION_RATE = 1
    const VERIFICATION_PERIOD = 50
    const VERIFICATION_SLASHING_PERIOD = 50
    const FAILED_VERIFICATION_SLASH_AMOUNT = 20 * PERC_MULTIPLIER
    const MISSED_VERIFICATION_SLASH_AMOUNT = 30 * PERC_MULTIPLIER
    const DOUBLE_CLAIM_SEGMENT_SLASH_AMOUNT = 40 * PERC_MULTIPLIER
    const FINDER_FEE = 4 * PERC_MULTIPLIER

    const JobStatus = {
        Inactive: 0,
        Active: 1
    }

    const ClaimStatus = {
        Pending: 0,
        Slashed: 1,
        Complete: 2
    }

    before(async () => {
        fixture = new Fixture(web3)
        await fixture.deploy()

        jobsManager = await fixture.deployAndRegister(JobsManager, "JobsManager", fixture.controller.address)

        await jobsManager.setVerificationRate(VERIFICATION_RATE)
        await jobsManager.setVerificationPeriod(VERIFICATION_PERIOD)
        await jobsManager.setVerificationSlashingPeriod(VERIFICATION_SLASHING_PERIOD)
        await jobsManager.setFailedVerificationSlashAmount(FAILED_VERIFICATION_SLASH_AMOUNT)
        await jobsManager.setMissedVerificationSlashAmount(MISSED_VERIFICATION_SLASH_AMOUNT)
        await jobsManager.setDoubleClaimSegmentSlashAmount(DOUBLE_CLAIM_SEGMENT_SLASH_AMOUNT)
        await jobsManager.setFinderFee(FINDER_FEE)
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("setController", () => {
        it("should fail if caller is not Controller", async () => {
            await expectThrow(jobsManager.setController(accounts[0]))
        })

        it("should set new Controller", async () => {
            await fixture.controller.updateController(contractId("JobsManager"), accounts[0])

            assert.equal(await jobsManager.controller.call(), accounts[0], "should set new Controller")
        })
    })

    describe("setVerificationRate", () => {
        it("should fail if caller is not Controller owner", async () => {
            await expectThrow(jobsManager.setVerificationRate(5, {from: accounts[2]}))
        })

        it("should fail if provided rate is 0", async () => {
            await expectThrow(jobsManager.setVerificationRate(0))
        })

        it("should set verificationRate", async () => {
            await jobsManager.setVerificationRate(10)

            assert.equal(await jobsManager.verificationRate.call(), 10, "wrong verificationRate")
        })
    })

    describe("setVerificationPeriod", () => {
        it("should fail if caller is not Controller owner", async () => {
            await expectThrow(jobsManager.setVerificationPeriod(60, {from: accounts[2]}))
        })

        it("should fail if provided verificationPeriod + current verification slashingPeriod > 256", async () => {
            const slashingPeriod = await jobsManager.verificationSlashingPeriod.call()
            await expectThrow(jobsManager.setVerificationPeriod((256 - slashingPeriod.toNumber()) + 1))
        })

        it("should set verificationPeriod", async () => {
            await jobsManager.setVerificationPeriod(60)

            assert.equal(await jobsManager.verificationPeriod.call(), 60, "wrong verificationPeriod")
        })
    })

    describe("setVerificationSlashingPeriod", () => {
        it("should fail if caller is not Controller owner", async () => {
            await expectThrow(jobsManager.setVerificationSlashingPeriod(60, {from: accounts[2]}))
        })

        it("should fail if provided verificationSlashingPeriod + current verificationPeriod > 256", async () => {
            const verificationPeriod = await jobsManager.verificationPeriod.call()
            await expectThrow(jobsManager.setVerificationSlashingPeriod((256 - verificationPeriod.toNumber()) + 1))
        })

        it("should set verificationSlashingPeriod", async () => {
            await jobsManager.setVerificationSlashingPeriod(60)

            assert.equal(await jobsManager.verificationSlashingPeriod.call(), 60, "wrong verificationSlashingPeriod")
        })
    })

    describe("setFailedVerificationSlashAmount", () => {
        it("should fail if caller is not Controller owner", async () => {
            await expectThrow(jobsManager.setFailedVerificationSlashAmount(15 * PERC_MULTIPLIER, {from: accounts[2]}))
        })

        it("should fail if provided failedVerificationSlashAmount is invalid percentage", async () => {
            await expectThrow(jobsManager.setFailedVerificationSlashAmount(PERC_DIVISOR + 1))
        })

        it("should set failedVerificationSlashAmount", async () => {
            await jobsManager.setFailedVerificationSlashAmount(15 * PERC_MULTIPLIER)

            assert.equal(await jobsManager.failedVerificationSlashAmount.call(), 15 * PERC_MULTIPLIER, "wrong failedVerificationSlashAmount")
        })
    })

    describe("setMissedVerificationSlashAmount", () => {
        it("should fail if caller is not Controller owner", async () => {
            await expectThrow(jobsManager.setMissedVerificationSlashAmount(15 * PERC_MULTIPLIER, {from: accounts[2]}))
        })

        it("should fail if provided missedVerificationSlashAmount is invalid percentage", async () => {
            await expectThrow(jobsManager.setMissedVerificationSlashAmount(PERC_DIVISOR + 1))
        })

        it("should set missedVerificationSlashAmount", async () => {
            await jobsManager.setMissedVerificationSlashAmount(15 * PERC_MULTIPLIER)

            assert.equal(await jobsManager.missedVerificationSlashAmount.call(), 15 * PERC_MULTIPLIER, "wrong failedVerificationSlashAmount")
        })
    })

    describe("setDoubleClaimSegmentSlashAmount", () => {
        it("should fail if caller is not Controller owner", async () => {
            await expectThrow(jobsManager.setDoubleClaimSegmentSlashAmount(15 * PERC_MULTIPLIER, {from: accounts[2]}))
        })

        it("should fail if provided doubleClaimSegmentSlashAmount is invalid percentage", async () => {
            await expectThrow(jobsManager.setDoubleClaimSegmentSlashAmount(PERC_DIVISOR + 1))
        })

        it("should set doubleClaimSegmentSlashAmount", async () => {
            await jobsManager.setDoubleClaimSegmentSlashAmount(15 * PERC_MULTIPLIER)

            assert.equal(await jobsManager.doubleClaimSegmentSlashAmount.call(), 15 * PERC_MULTIPLIER, "wrong doubleClaimSegmentSlashAmount")
        })
    })

    describe("setFinderFee", () => {
        it("should fail if caller is not Controller owner", async () => {
            await expectThrow(jobsManager.setFinderFee(10 * PERC_MULTIPLIER, {from: accounts[2]}))
        })

        it("should fail if provided finderFee is invalid percentage", async () => {
            await expectThrow(jobsManager.setFinderFee(PERC_DIVISOR + 1))
        })

        it("should set finderFee", async () => {
            await jobsManager.setFinderFee(10 * PERC_MULTIPLIER)

            assert.equal(await jobsManager.finderFee.call(), 10 * PERC_MULTIPLIER, "wrong finderFee")
        })
    })

    describe("deposit", () => {
        const broadcaster = accounts[0]

        it("should increase broadcaster's deposit", async () => {
            await jobsManager.deposit({from: broadcaster, value: 1000})

            const bInfo = await jobsManager.broadcasters.call(broadcaster)
            assert.equal(bInfo[0], 1000, "wrong deposit")
        })
    })

    describe("withdraw", () => {
        const broadcaster = accounts[0]
        const currentBlock = 100
        const endBlock = 150

        beforeEach(async () => {
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock)

            await jobsManager.deposit({from: broadcaster, value: 1000})
            const transcodingOptions = createTranscodingOptions(["foo"])
            await jobsManager.job("foo", transcodingOptions, 1, endBlock, {from: broadcaster})
        })

        it("should fail if broadcaster's withdraw block is in the future", async () => {
            await expectThrow(jobsManager.withdraw({from: broadcaster}))
        })

        it("should zero out broadcaster's deposit and withdraw block", async () => {
            // Fast forward through end block
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), endBlock)

            await jobsManager.withdraw({from: broadcaster})

            const bInfo = await jobsManager.broadcasters.call(broadcaster)
            assert.equal(bInfo[0], 0, "wrong deposit")
            assert.equal(bInfo[1], 0, "wrong withdraw block")
        })
    })

    describe("job", () => {
        const broadcaster = accounts[0]
        const currentBlock = 100
        const currentRound = 2
        const transcodingOptions = createTranscodingOptions(["foo"])

        beforeEach(async () => {
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
        })

        it("should fail if end block is not in the future", async () => {
            await expectThrow(jobsManager.job("foo", transcodingOptions, 1, currentBlock, {from: broadcaster}))
        })

        it("should fail if transcodingOptions is invalid (not a multiple of video profile id size)", async () => {
            await expectThrow(jobsManager.job("foo", "bar", 1, currentBlock + 50, {from: broadcaster}))
        })

        it("should fail if transcodingOptions is invalid (0 length)", async () => {
            await expectThrow(jobsManager.job("foo", "", 1, currentBlock + 50, {from: broadcaster}))
        })

        it("should create a transcode job", async () => {
            await jobsManager.job("foo", transcodingOptions, 1, currentBlock + 50, {from: broadcaster})

            const jInfo = await jobsManager.getJob(0)
            assert.equal(jInfo[0], "foo", "wrong streamId")
            assert.equal(jInfo[1], transcodingOptions, "wrong transcodingOptions")
            assert.equal(jInfo[2], 1, "wrong maxPricePerSegment")
            assert.equal(jInfo[3], broadcaster, "wrong broadcasterAddress")
            assert.equal(jInfo[4], constants.NULL_ADDRESS, "wrong transcoderAddress")
            assert.equal(jInfo[5], currentRound, "wrong creationRound")
            assert.equal(jInfo[6], currentBlock, "wrong creationBlock")
            assert.equal(jInfo[7], currentBlock + 50, "wrong endBlock")
            assert.equal(jInfo[8], 0, "wrong escrow")
            assert.equal(jInfo[9], 0, "wrong totalClaims")
        })

        it("should create a new NewJob event", async () => {
            const e = jobsManager.NewJob({})

            e.watch(async (err, result) => {
                e.stopWatching()

                assert.equal(result.args.broadcaster, broadcaster, "wrong broadcaster")
                assert.equal(result.args.jobId, 0, "wrong jobId")
                assert.equal(result.args.streamId, "foo", "wrong streamId")
                assert.equal(result.args.transcodingOptions, transcodingOptions, "wrong transcodingOptions")
            })

            await jobsManager.job("foo", transcodingOptions, 1, currentBlock + 50, {from: broadcaster})
        })

        it("should set the broadcaster's withdraw block to the job's end block if the job's end block > broadcaster's withdraw block", async () => {
            await jobsManager.deposit({from: broadcaster, value: 1000})
            await jobsManager.job("foo", transcodingOptions, 1, currentBlock + 50, {from: broadcaster})

            const bInfo = await jobsManager.broadcasters.call(broadcaster)
            assert.equal(bInfo[1], currentBlock + 50, "wrong broadcaster withdrawBlock")
        })

        it("should not change the broadcaster's withdraw block if the job's end block <= broadcaster's withdraw block", async () => {
            await jobsManager.deposit({from: broadcaster, value: 1000})
            await jobsManager.job("foo", transcodingOptions, 1, currentBlock + 50, {from: broadcaster})
            await jobsManager.job("foo", transcodingOptions, 1, currentBlock + 50, {from: broadcaster})

            const bInfo = await jobsManager.broadcasters.call(broadcaster)
            assert.equal(bInfo[1], currentBlock + 50, "wrong broadcaster withdrawBlock")
        })
    })

    describe("claimWork", () => {
        const broadcaster = accounts[0]
        const transcoder = accounts[1]
        const currentBlock = 100
        const currentRound = 2
        const transcodingOptions = createTranscodingOptions(["foo"])
        const segmentRange = [0, 3]
        const claimRoot = web3.sha3("foo")

        beforeEach(async () => {
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await fixture.bondingManager.setMockAddress(functionSig("electActiveTranscoder(uint256,bytes32,uint256)"), transcoder)
            await fixture.bondingManager.setMockBool(functionSig("isRegisteredTranscoder(address)"), true)

            await jobsManager.deposit({from: broadcaster, value: 1000})
            // Broadcaster creates job 0
            await jobsManager.job("foo", transcodingOptions, 1, currentBlock + 20, {from: broadcaster})
            // Broadcaster creates job 1
            await jobsManager.job("foo", transcodingOptions, 1, currentBlock + 50, {from: broadcaster})
        })

        it("should fail if the job does not exist", async () => {
            const invalidJobId = 2
            await expectThrow(jobsManager.claimWork(invalidJobId, segmentRange, claimRoot, {from: transcoder}))
        })

        it("should fail if the job is inactive", async () => {
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock + 20)
            const inactiveJobId = 0
            await expectThrow(jobsManager.claimWork(inactiveJobId, segmentRange, claimRoot, {from: transcoder}))
        })

        it("should fail if segment range is invalid", async () => {
            await expectThrow(jobsManager.claimWork(1, [3, 0], claimRoot, {from: transcoder}))
        })

        it("should fail if caller is not a registered transcoder", async () => {
            await fixture.bondingManager.setMockBool(functionSig("isRegisteredTranscoder(address)"), false)

            await expectThrow(jobsManager.claimWork(1, segmentRange, claimRoot, {from: transcoder}))
        })

        it("should fail if the transcoder address is set and does not match caller address", async () => {
            // First claim - set transcoder address
            await jobsManager.claimWork(1, segmentRange, claimRoot, {from: transcoder})

            await expectThrow(jobsManager.claimWork(1, segmentRange, claimRoot, {from: accounts[2]}))
        })

        it("should fail if the transcoder address is not set and the caller is not assigned", async () => {
            await expectThrow(jobsManager.claimWork(1, segmentRange, claimRoot, {from: accounts[2]}))
        })

        it("should set the transcoder address if this is the first claim and the caller is assigned", async () => {
            await jobsManager.claimWork(1, segmentRange, claimRoot, {from: transcoder})

            const jInfo = await jobsManager.getJob(1)
            assert.equal(jInfo[4], transcoder, "wrong transcoderAddress")
        })

        it("should transfer fees to job escrow and decrease broadcaster deposit", async () => {
            await jobsManager.claimWork(1, segmentRange, claimRoot, {from: transcoder})

            const fees = (transcodingOptions.length / 8) * (segmentRange[1] - segmentRange[0] + 1)

            const jInfo = await jobsManager.getJob(1)
            assert.equal(jInfo[8].toNumber(), fees, "wrong job escrow")
            const bInfo = await jobsManager.broadcasters.call(broadcaster)
            assert.equal(bInfo[0], 1000 - fees, "wrong broadcaster deposit")
        })

        it("should create a NewClaim event", async () => {
            const e = jobsManager.NewClaim({})

            e.watch(async (err, result) => {
                e.stopWatching()

                assert.equal(result.args.transcoder, transcoder, "transcoder incorrect")
                assert.equal(result.args.jobId, 1, "job id incorrect")
                assert.equal(result.args.claimId, 0, "claim id incorrect")
            })

            await jobsManager.claimWork(1, segmentRange, claimRoot, {from: transcoder})
        })

        it("should create a transcode claim", async () => {
            const claimBlock = currentBlock + 1
            const verificationPeriod = await jobsManager.verificationPeriod.call()
            const slashingPeriod = await jobsManager.verificationSlashingPeriod.call()
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), claimBlock)
            await jobsManager.claimWork(1, segmentRange, claimRoot, {from: transcoder})

            const cInfo = await jobsManager.getClaim(1, 0)
            assert.equal(cInfo[0][0], segmentRange[0], "wrong segment range start")
            assert.equal(cInfo[0][1], segmentRange[1], "wrong segment range end")
            assert.equal(cInfo[1], claimRoot, "wrong claimRoot")
            assert.equal(cInfo[2], claimBlock, "wrong claimBlock")
            assert.equal(cInfo[3], claimBlock + verificationPeriod.toNumber(), "wrong endVerificationBlock")
            assert.equal(cInfo[4], claimBlock + verificationPeriod.toNumber() + slashingPeriod.toNumber(), "wrong endSlashingBlock")
            assert.equal(cInfo[5], ClaimStatus.Pending, "wrong status")
        })
    })

    describe("verify", () => {
        const broadcaster = accounts[0]
        const transcoder = accounts[1]
        const currentBlock = 100
        const currentRound = 2
        const transcodingOptions = createTranscodingOptions(["foo"])
        const segmentRange = [0, 3]

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

        const dataStorageHash = "0x123"
        const correctDataHash = dataHashes[0]
        const correctTDataHash = tDataHashes[0]
        const correctDataHashes = [correctDataHash, correctTDataHash]
        const correctSig = ethUtil.bufferToHex(segments[0].signedHash())
        const correctProof = merkleTree.getHexProof(tReceiptHashes[0])

        beforeEach(async () => {
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await fixture.bondingManager.setMockAddress(functionSig("electActiveTranscoder(uint256,bytes32,uint256)"), transcoder)
            await fixture.bondingManager.setMockBool(functionSig("isRegisteredTranscoder(address)"), true)

            await jobsManager.deposit({from: broadcaster, value: 1000})
            // Broadcaster creates job 0
            await jobsManager.job("foo", transcodingOptions, 1, currentBlock + 20, {from: broadcaster})

            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock + 1)
            // Transcoder claims work for job 0
            await jobsManager.claimWork(0, segmentRange, merkleTree.getHexRoot(), {from: transcoder})
            // Claim block + 1 is mined
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock + 2)
        })

        it("should fail if insufficient payment is provided", async () => {
            await fixture.verifier.setMockUint256(functionSig("getPrice()"), 10)
            await expectThrow(jobsManager.verify(0, 0, 0, dataStorageHash, correctDataHashes, correctSig, correctProof, {from: transcoder}))
        })

        it("should fail if job does not exist", async () => {
            const invalidJobId = 2
            await expectThrow(jobsManager.verify(invalidJobId, 0, 0, dataStorageHash, correctDataHashes, correctSig, correctProof, {from: transcoder}))
        })

        it("should fail if transcoder address for claim does not match caller address", async () => {
            await expectThrow(jobsManager.verify(0, 0, 0, dataStorageHash, correctDataHashes, correctSig, correctProof, {from: accounts[3]}))
        })

        it("should fail if segment should not be verified because it is not in the claim's segment range", async () => {
            const invalidSegmentNumber = 99
            await expectThrow(jobsManager.verify(0, 0, invalidSegmentNumber, dataStorageHash, correctDataHashes, correctSig, correctProof, {from: transcoder}))
        })

        it("should fail if segment should not be verified because it was not challenged", async () => {
            // Only 1 out of 1000000000000 segments should be verified
            await jobsManager.setVerificationRate(1000000000000)
            // The probability of a challenged segment should be so low that this call will fail *most* of the time
            await expectThrow(jobsManager.verify(0, 0, 0, dataStorageHash, correctDataHashes, correctSig, correctProof, {from: transcoder}))
        })

        it("should fail if broadcaster signature over segment data is invalid", async () => {
            const badSig = web3.eth.sign(accounts[3], ethUtil.bufferToHex(segments[0].hash()))
            // This should fail because badSig is not signed by the broadcaster
            await expectThrow(jobsManager.verify(0, 0, 0, dataStorageHash, correctDataHashes, badSig, correctProof, {from: transcoder}))
        })

        it("should fail if Merkle proof for transcode receipt is invalid", async () => {
            const badProof = merkleTree.getHexProof(tReceiptHashes[1])
            // This should fail becasue badProof is the Merkle proof for tReceiptHashes[1] instead of tReceiptHashes[0]
            await expectThrow(jobsManager.verify(0, 0, 0, dataStorageHash, correctDataHashes, correctSig, badProof, {from: transcoder}))
        })

        it("should fail if non-zero value is provided when the price of verification is 0", async () => {
            await fixture.verifier.setMockUint256(functionSig("getPrice()"), 0)
            await expectThrow(jobsManager.verify(0, 0, 0, dataStorageHash, correctDataHashes, correctSig, correctProof, {from: transcoder, value: 100}))
        })

        it("should mark segment as submitted for verification", async () => {
            await jobsManager.verify(0, 0, 0, dataStorageHash, correctDataHashes, correctSig, correctProof, {from: transcoder})

            assert.isOk(await jobsManager.isClaimSegmentVerified(0, 0, 0), "claim segment not marked as submitted for verification")
        })

        it("should forward ETH payment to verifier if price > 0", async () => {
            await fixture.verifier.setMockUint256(functionSig("getPrice()"), 100)
            await jobsManager.verify(0, 0, 0, dataStorageHash, correctDataHashes, correctSig, correctProof, {from: transcoder, value: 100})

            assert.equal(web3.eth.getBalance(fixture.verifier.address), 100, "wrong verifier ETH balance")
        })
    })

    describe("receiveVerification", () => {
        const broadcaster = accounts[0]
        const transcoder = accounts[1]
        const currentBlock = 100
        const currentRound = 2
        const transcodingOptions = createTranscodingOptions(["foo"])
        const segmentRange = [0, 3]

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

        const dataStorageHash = "0x123"
        const correctDataHash = dataHashes[0]
        const correctTDataHash = tDataHashes[0]
        const correctDataHashes = [correctDataHash, correctTDataHash]
        const correctSig = ethUtil.bufferToHex(segments[0].signedHash())
        const correctProof = merkleTree.getHexProof(tReceiptHashes[0])

        beforeEach(async () => {
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await fixture.bondingManager.setMockAddress(functionSig("electActiveTranscoder(uint256,bytes32,uint256)"), transcoder)
            await fixture.bondingManager.setMockBool(functionSig("isRegisteredTranscoder(address)"), true)

            await jobsManager.deposit({from: broadcaster, value: 1000})
            // Broadcaster creates job 0
            await jobsManager.job("foo", transcodingOptions, 1, currentBlock + 20, {from: broadcaster})

            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock + 1)
            // Transcoder claims work for job 0
            await jobsManager.claimWork(0, segmentRange, merkleTree.getHexRoot(), {from: transcoder})
            // Claim block + 1 is mined
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock + 2)
            // Submit segment 0 for verification
            await jobsManager.verify(0, 0, 0, dataStorageHash, correctDataHashes, correctSig, correctProof, {from: transcoder})
        })

        it("should fail if caller is not the verifier", async () => {
            await expectThrow(jobsManager.receiveVerification(0, 0, 0, true, {from: transcoder}))
        })

        it("should fail if job does not exist", async () => {
            await expectThrow(
                fixture.verifier.execute(
                    jobsManager.address,
                    functionEncodedABI("receiveVerification(uint256,uint256,uint256,bool)", ["uint256", "uint256", "uint256", "bool"], [1, 0, 0, false])
                )
            )
        })

        it("should fail if claim does not exist", async () => {
            await expectThrow(
                fixture.verifier.execute(
                    jobsManager.address,
                    functionEncodedABI("receiveVerification(uint256,uint256,uint256,bool)", ["uint256", "uint256", "uint256", "bool"], [0, 1, 0, false])
                )
            )
        })

        it("should fail if segment was not submitted for verification", async () => {
            await expectThrow(
                fixture.verifier.execute(
                    jobsManager.address,
                    functionEncodedABI("receiveVerification(uint256,uint256,uint256,bool)", ["uint256", "uint256", "uint256", "bool"], [0, 0, 2, false])
                )
            )
        })

        it("should fail if claim was slashed", async () => {
            await fixture.verifier.execute(
                jobsManager.address,
                functionEncodedABI("receiveVerification(uint256,uint256,uint256,bool)", ["uint256", "uint256", "uint256", "bool"], [0, 0, 0, false])
            )

            // This should fail because claim 0 was already slashed
            await expectThrow(
                fixture.verifier.execute(
                    jobsManager.address,
                    functionEncodedABI("receiveVerification(uint256,uint256,uint256,bool)", ["uint256", "uint256", "uint256", "bool"], [0, 0, 0, false])
                )
            )
        })

        describe("result is false", () => {
            it("should refund broadcaster and slash claim", async () => {
                // Call receiveVerification from the verifier
                await fixture.verifier.execute(jobsManager.address, functionEncodedABI("receiveVerification(uint256,uint256,uint256,bool)", ["uint256", "uint256", "uint256", "bool"], [0, 0, 0, false]))

                assert.equal(await jobsManager.jobStatus(0), JobStatus.Inactive, "wrong job status")
                assert.equal((await jobsManager.getClaim(0, 0))[5], ClaimStatus.Slashed, "wrong claim status")
                const bDeposit = (await jobsManager.broadcasters.call(broadcaster))[0]
                assert.equal(bDeposit, 1000, "broadcaster deposit should be restored")
                const jEscrow = (await jobsManager.getJob(0))[8]
                assert.equal(jEscrow, 0, "job escrow should be zero")
                const endBlock = (await jobsManager.getJob(0))[7]
                assert.equal(endBlock, currentBlock + 2, "wrong job end block")
            })
        })

        describe("result is true", () => {
            it("should create a PassedVerification event", async () => {
                const e = jobsManager.PassedVerification({})

                e.watch(async (err, result) => {
                    e.stopWatching()

                    assert.equal(result.args.transcoder, transcoder, "transcoder incorrect")
                    assert.equal(result.args.jobId, 0, "job id incorrect")
                    assert.equal(result.args.claimId, 0, "claim id incorrect")
                    assert.equal(result.args.segmentNumber, 0, "segment number incorrect")
                })

                // Call receiveVerification from the verifier
                await fixture.verifier.execute(jobsManager.address, functionEncodedABI("receiveVerification(uint256,uint256,uint256,bool)", ["uint256", "uint256", "uint256", "bool"], [0, 0, 0, true]))
            })
        })
    })

    describe("distributeFees", () => {
        const broadcaster = accounts[0]
        const transcoder = accounts[1]
        const currentBlock = 100
        const currentRound = 2
        const transcodingOptions = createTranscodingOptions(["foo"])
        const segmentRange = [0, 3]
        const claimRoot = web3.sha3("foo")

        beforeEach(async () => {
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await fixture.bondingManager.setMockAddress(functionSig("electActiveTranscoder(uint256,bytes32,uint256)"), transcoder)
            await fixture.bondingManager.setMockBool(functionSig("isRegisteredTranscoder(address)"), true)

            await jobsManager.deposit({from: broadcaster, value: 1000})
            // Broadcaster creates job 0
            await jobsManager.job("foo", transcodingOptions, 1, currentBlock + 20, {from: broadcaster})

            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock + 1)
            // Transcoder claims work for job 0
            await jobsManager.claimWork(0, segmentRange, claimRoot, {from: transcoder})
        })

        it("should fail if job does not exist", async () => {
            // Fast forward through verification period and verification slashing period
            const endSlashingBlock = (await jobsManager.getClaim(0, 0))[4]
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), endSlashingBlock)

            const invalidJobId = 1
            await expectThrow(jobsManager.distributeFees(invalidJobId, 0, {from: transcoder}))
        })

        it("should fail if claim does not exist", async () => {
            await expectThrow(jobsManager.distributeFees(0, 1, {from: transcoder}))
        })

        it("should fail if transcoder address does not match caller address", async () => {
            // Fast forward through verification period and verification slashing period
            const endSlashingBlock = (await jobsManager.getClaim(0, 0))[4]
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), endSlashingBlock)

            await expectThrow(jobsManager.distributeFees(0, 0, {from: accounts[3]}))
        })

        it("should fail if the claim is slashed and thus not pending", async () => {
            // Fast forward through verification period
            const endVerificationBlock = (await jobsManager.getClaim(0, 0))[3]
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), endVerificationBlock.add(1))

            await jobsManager.missedVerificationSlash(0, 0, 0, {from: accounts[3]})

            // This should fail because the claim is slashed
            await expectThrow(jobsManager.distributeFees(0, 0, {from: transcoder}))
        })

        it("should fail if the claim is complete and thus not pending", async () => {
            // Fast forward through verification period and verification slashing period
            const endSlashingBlock = (await jobsManager.getClaim(0, 0))[4]
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), endSlashingBlock)
            await jobsManager.distributeFees(0, 0, {from: transcoder})

            // This should fail because the claim is already complete
            await expectThrow(jobsManager.distributeFees(0, 0, {from: transcoder}))
        })

        it("should fail if the claim's slashing period is not over", async () => {
            // Fast forward through verification period and verification slashing period
            const verificationPeriod = await jobsManager.verificationPeriod.call()
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock + verificationPeriod.toNumber())

            await expectThrow(jobsManager.distributeFees(0, 0, {from: transcoder}))
        })

        it("should decrease the job's escrow", async () => {
            // Fast forward through verification period and verification slashing period
            const endSlashingBlock = (await jobsManager.getClaim(0, 0))[4]
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), endSlashingBlock)

            await jobsManager.distributeFees(0, 0, {from: transcoder})

            const jEscrow = (await jobsManager.getJob(0))[8]
            assert.equal(jEscrow, 0, "wrong job escrow")
        })

        it("should set the claim as complete", async () => {
            // Fast forward through verification period and verification slashing period
            const endSlashingBlock = (await jobsManager.getClaim(0, 0))[4]
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), endSlashingBlock)

            await jobsManager.distributeFees(0, 0, {from: transcoder})

            const cStatus = (await jobsManager.getClaim(0, 0))[5]
            assert.equal(cStatus, ClaimStatus.Complete, "wrong claim status")
        })
    })

    describe("batchDistributeFees", () => {
        const broadcaster = accounts[0]
        const transcoder = accounts[1]
        const currentBlock = 100
        const currentRound = 2
        const transcodingOptions = createTranscodingOptions(["foo"])
        const segmentRange = [0, 3]
        const claimRoot = web3.sha3("foo")

        beforeEach(async () => {
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await fixture.bondingManager.setMockAddress(functionSig("electActiveTranscoder(uint256,bytes32,uint256)"), transcoder)
            await fixture.bondingManager.setMockBool(functionSig("isRegisteredTranscoder(address)"), true)

            await jobsManager.deposit({from: broadcaster, value: 1000})
            // Broadcaster creates job 0
            await jobsManager.job("foo", transcodingOptions, 1, currentBlock + 20, {from: broadcaster})

            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock + 1)
            // Transcoder claims work for job 0 by submitting claim 0
            await jobsManager.claimWork(0, segmentRange, claimRoot, {from: transcoder})
            // Fast forward so the second claim is made later than the first claim
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock + 5)
            // Transcoder claims work for job 0 by submitting claim 1
            await jobsManager.claimWork(0, segmentRange, claimRoot, {from: transcoder})
        })

        it("should fail if distributeFees fails for any of the claim ids", async () => {
            // Fast forward through verification period and verification slashing period of claim 0
            const endSlashingBlock0 = (await jobsManager.getClaim(0, 0))[4]
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), endSlashingBlock0)

            // This should fail because distributeFees should fail for claim 1 (slashing period not over)
            await expectThrow(jobsManager.batchDistributeFees(0, [0, 1], {from: transcoder}))
        })

        it("should call distributeFees for each claim id", async () => {
            // Fast forward through verification period and verification slashing period of claim 0 and 1j
            const endSlashingBlock1 = (await jobsManager.getClaim(0, 1))[4]
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), endSlashingBlock1)

            await jobsManager.batchDistributeFees(0, [0, 1], {from: transcoder})

            const jEscrow = (await jobsManager.getJob(0))[8]
            assert.equal(jEscrow, 0, "wrong job escrow")

            const cStatus0 = (await jobsManager.getClaim(0, 0))[5]
            assert.equal(cStatus0, ClaimStatus.Complete, "wrong claim 0 status")
            const cStatus1 = (await jobsManager.getClaim(0, 1))[5]
            assert.equal(cStatus1, ClaimStatus.Complete, "wrong claim 1 status")
        })
    })

    describe("missedVerificationSlash", () => {
        const broadcaster = accounts[0]
        const transcoder = accounts[1]
        const watcher = accounts[2]
        const currentBlock = 100
        const currentRound = 2
        const transcodingOptions = createTranscodingOptions(["foo"])
        const segmentRange = [0, 3]

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

        const dataStorageHash = "0x123"
        const correctDataHash = dataHashes[0]
        const correctTDataHash = tDataHashes[0]
        const correctDataHashes = [correctDataHash, correctTDataHash]
        const correctSig = ethUtil.bufferToHex(segments[0].signedHash())
        const correctProof = merkleTree.getHexProof(tReceiptHashes[0])

        beforeEach(async () => {
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await fixture.bondingManager.setMockAddress(functionSig("electActiveTranscoder(uint256,bytes32,uint256)"), transcoder)
            await fixture.bondingManager.setMockBool(functionSig("isRegisteredTranscoder(address)"), true)

            await jobsManager.deposit({from: broadcaster, value: 1000})
            // Broadcaster creates job 0
            await jobsManager.job("foo", transcodingOptions, 1, currentBlock + 20, {from: broadcaster})

            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock + 1)
            // Transcoder claims work for job 0 by submitting claim 0
            await jobsManager.claimWork(0, segmentRange, merkleTree.getHexRoot(), {from: transcoder})
            // Claim block + 1 is mined
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock + 2)
        })

        it("should fail if job does not exist", async () => {
            // Fast forward through verification period
            const endVerificationBlock = (await jobsManager.getClaim(0, 0))[3]
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), endVerificationBlock.add(1))

            const invalidJobId = 1
            await expectThrow(jobsManager.missedVerificationSlash(invalidJobId, 0, 0, {from: watcher}))
        })

        it("should fail if verification period is not over", async () => {
            await expectThrow(jobsManager.missedVerificationSlash(0, 0, 0, {from: transcoder}))
        })

        it("should fail if verification slashing period is over", async () => {
            // Fast forward through verification period and verification slashing period
            const endSlashingBlock = (await jobsManager.getClaim(0, 0))[4]
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), endSlashingBlock)

            await expectThrow(jobsManager.missedVerificationSlash(0, 0, 0, {from: watcher}))
        })

        it("should fail if claim is not pending", async () => {
            // Fast forward through verification period
            const endVerificationBlock = (await jobsManager.getClaim(0, 0))[3]
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), endVerificationBlock.add(1))

            await jobsManager.missedVerificationSlash(0, 0, 0, {from: watcher})

            // This should fail because the claim is already slashed
            await expectThrow(jobsManager.missedVerificationSlash(0, 0, 0, {from: watcher}))
        })

        it("should fail if segment was not challenged for verification", async () => {
            // Fast forward through verification period
            const endVerificationBlock = (await jobsManager.getClaim(0, 0))[3]
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), endVerificationBlock.add(1))
            // Only 1 out of 1000000000000 segments should be verified
            await jobsManager.setVerificationRate(1000000000000)

            // The probability of a challenged segment should be so low that this call will fail *most* of the time
            await expectThrow(jobsManager.missedVerificationSlash(0, 0, 0, {from: watcher}))
        })

        it("should fail if segment was submitted for verification", async () => {
            await jobsManager.verify(0, 0, 0, dataStorageHash, correctDataHashes, correctSig, correctProof, {from: transcoder})
            // Fast forward through verification period
            const endVerificationBlock = (await jobsManager.getClaim(0, 0))[3]
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), endVerificationBlock.add(1))

            await expectThrow(jobsManager.missedVerificationSlash(0, 0, 0, {from: watcher}))
        })

        it("should refund the broadcaster", async () => {
            // Fast forward through verification period
            const endVerificationBlock = (await jobsManager.getClaim(0, 0))[3]
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), endVerificationBlock.add(1))

            await jobsManager.missedVerificationSlash(0, 0, 0, {from: watcher})

            const bDeposit = (await jobsManager.broadcasters.call(broadcaster))[0]
            assert.equal(bDeposit, 1000, "wrong broadcaster deposit")
            const jEscrow = (await jobsManager.getJob(0))[8]
            assert.equal(jEscrow, 0, "wrong job escrow")
        })

        it("should set job as inactive by setting its end block to the current block", async () => {
            // Fast forward through verification period
            const endVerificationBlock = (await jobsManager.getClaim(0, 0))[3]
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), endVerificationBlock.add(1))

            await jobsManager.missedVerificationSlash(0, 0, 0, {from: watcher})

            assert.equal(await jobsManager.jobStatus(0), JobStatus.Inactive, "wrong job status")

            const endBlock = (await jobsManager.getJob(0))[7]
            assert.equal(endBlock, endVerificationBlock.add(1).toNumber(), "wrong job end block")
        })

        it("should set the claim as slashed", async () => {
            // Fast forward through verification period
            const endVerificationBlock = (await jobsManager.getClaim(0, 0))[3]
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), endVerificationBlock.add(1))

            await jobsManager.missedVerificationSlash(0, 0, 0, {from: watcher})

            const cStatus = (await jobsManager.getClaim(0, 0))[5]
            assert.equal(cStatus, ClaimStatus.Slashed, "wrong claim status")
        })
    })

    describe("doubleClaimSegmentSlash", () => {
        const broadcaster = accounts[0]
        const transcoder = accounts[1]
        const watcher = accounts[2]
        const currentBlock = 100
        const currentRound = 2
        const transcodingOptions = createTranscodingOptions(["foo"])
        const claimRoot = web3.sha3("foo")

        beforeEach(async () => {
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await fixture.bondingManager.setMockAddress(functionSig("electActiveTranscoder(uint256,bytes32,uint256)"), transcoder)
            await fixture.bondingManager.setMockBool(functionSig("isRegisteredTranscoder(address)"), true)

            await jobsManager.deposit({from: broadcaster, value: 1000})
            // Broadcaster creates job 0
            await jobsManager.job("foo", transcodingOptions, 1, currentBlock + 20, {from: broadcaster})

            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock + 1)
            // Transcoder claims work for job 0 by submitting claim 0
            await jobsManager.claimWork(0, [0, 3], claimRoot, {from: transcoder})
            // Transcoder claims work for job 0 by submitting claim 1 - overlap in segment range as claim 0
            await jobsManager.claimWork(0, [0, 2], claimRoot, {from: transcoder})
            // Claim block + 1 is mined
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock + 2)
        })

        it("should fail if job does not exist", async () => {
            const invalidJobId = 1
            await expectThrow(jobsManager.doubleClaimSegmentSlash(invalidJobId, 0, 1, 0, {from: watcher}))
        })

        it("should fail if claim 0 does not exist", async () => {
            const invalidClaimId0 = 5
            await expectThrow(jobsManager.doubleClaimSegmentSlash(0, invalidClaimId0, 1, 0, {from: watcher}))
        })

        it("should fail if claim 1 does not exist", async () => {
            const invalidClaimId1 = 5
            await expectThrow(jobsManager.doubleClaimSegmentSlash(0, 0, invalidClaimId1, 0, {from: watcher}))
        })

        it("should fail if claim 0 is slashed", async () => {
            // Fast forward through verification period
            const endVerificationBlock = (await jobsManager.getClaim(0, 0))[3]
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), endVerificationBlock.add(1))
            // Slash transcoder for missed verification with claim 0
            await jobsManager.missedVerificationSlash(0, 0, 0, {from: watcher})

            // This should fail because claim 0 is already slashed
            await expectThrow(jobsManager.doubleClaimSegmentSlash(0, 0, 1, 0, {from: watcher}))
        })

        it("should fail if claim 1 is slashed", async () => {
            // Fast forward through verification period
            const endVerificationBlock = (await jobsManager.getClaim(0, 1))[3]
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), endVerificationBlock.add(1))
            // Slash transcoder for missed verification with claim 1
            await jobsManager.missedVerificationSlash(0, 1, 0, {from: watcher})

            // This should fail because claim 1 is already slashed
            await expectThrow(jobsManager.doubleClaimSegmentSlash(0, 0, 1, 0, {from: watcher}))
        })

        it("should fail if segment is not in segment range of claim 0", async () => {
            await expectThrow(jobsManager.doubleClaimSegmentSlash(0, 0, 1, 4, {from: watcher}))
        })

        it("should fail if segment is not in segment range of claim 1", async () => {
            await expectThrow(jobsManager.doubleClaimSegmentSlash(0, 0, 1, 3, {from: watcher}))
        })

        it("should refund broadcaster", async () => {
            await jobsManager.doubleClaimSegmentSlash(0, 0, 1, 0, {from: watcher})

            const bDeposit = (await jobsManager.broadcasters.call(broadcaster))[0]
            assert.equal(bDeposit, 1000, "wrong broadcaster deposit")
            const jEscrow = (await jobsManager.getJob(0))[8]
            assert.equal(jEscrow, 0, "wrong job escrow")
        })

        it("should set job as inactive by setting its end block to the current block", async () => {
            await jobsManager.doubleClaimSegmentSlash(0, 0, 1, 0, {from: watcher})

            assert.equal(await jobsManager.jobStatus(0), JobStatus.Inactive, "wrong job status")

            const endBlock = (await jobsManager.getJob(0))[7]
            assert.equal(endBlock, currentBlock + 2, "wrong job end block")
        })

        it("should set both claims as slashed", async () => {
            await jobsManager.doubleClaimSegmentSlash(0, 0, 1, 0, {from: watcher})

            const cStatus0 = (await jobsManager.getClaim(0, 0))[5]
            assert.equal(cStatus0, ClaimStatus.Slashed, "wrong claim 0 status")
            const cStatus1 = (await jobsManager.getClaim(0, 1))[5]
            assert.equal(cStatus1, ClaimStatus.Slashed, "wrong claim 1 status")
        })
    })

    describe("jobStatus", () => {
        const broadcaster = accounts[0]
        const currentBlock = 100
        const currentRound = 2
        const transcodingOptions = createTranscodingOptions(["foo"])

        beforeEach(async () => {
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)

            await jobsManager.job("foo", transcodingOptions, 1, currentBlock + 50, {from: broadcaster})
        })

        it("should return active if job's end block is in the future", async () => {
            assert.equal(await jobsManager.jobStatus(0), JobStatus.Active, "wrong job status when job is active")
        })

        it("should return inactive if job's end block is now or in the past", async () => {
            // Fast forward through job's end block
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock + 50)

            assert.equal(await jobsManager.jobStatus(0), JobStatus.Inactive, "wrong job status when job is inactive")
        })
    })

    describe("isClaimSegmentVerified", () => {
        const broadcaster = accounts[0]
        const transcoder = accounts[1]
        const currentBlock = 100
        const currentRound = 2
        const transcodingOptions = createTranscodingOptions(["foo"])
        const segmentRange = [0, 3]

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

        const dataStorageHash = "0x123"
        const correctDataHash = dataHashes[0]
        const correctTDataHash = tDataHashes[0]
        const correctDataHashes = [correctDataHash, correctTDataHash]
        const correctSig = ethUtil.bufferToHex(segments[0].signedHash())
        const correctProof = merkleTree.getHexProof(tReceiptHashes[0])

        beforeEach(async () => {
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await fixture.bondingManager.setMockAddress(functionSig("electActiveTranscoder(uint256,bytes32,uint256)"), transcoder)
            await fixture.bondingManager.setMockBool(functionSig("isRegisteredTranscoder(address)"), true)

            await jobsManager.deposit({from: broadcaster, value: 1000})
            // Broadcaster creates job 0
            await jobsManager.job("foo", transcodingOptions, 1, currentBlock + 20, {from: broadcaster})

            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock + 1)
            // Transcoder claims work for job 0
            await jobsManager.claimWork(0, segmentRange, merkleTree.getHexRoot(), {from: transcoder})
            // Claim block + 1 is mined
            await fixture.roundsManager.setMockUint256(functionSig("blockNum()"), currentBlock + 2)
            // Submit segment 0 for verification
            await jobsManager.verify(0, 0, 0, dataStorageHash, correctDataHashes, correctSig, correctProof, {from: transcoder})
        })

        it("should return true if a segment in a claim has been submitted for verification", async () => {
            assert.isOk(await jobsManager.isClaimSegmentVerified(0, 0, 0), "not true for segment submitted for verification")
        })

        it("should return false if a segment in a claim has not been submitted for verification", async () => {
            assert.isNotOk(await jobsManager.isClaimSegmentVerified(0, 0, 1), "not false for segment submitted for verification")
        })
    })
})
