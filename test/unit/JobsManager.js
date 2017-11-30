import Fixture from "../helpers/fixture"
import expectThrow from "../helpers/expectThrow"
import MerkleTree from "../../utils/merkleTree"
import batchTranscodeReceiptHashes from "../../utils/batchTranscodeReceipts"
import {createTranscodingOptions} from "../../utils/videoProfile"
import Segment from "../../utils/segment"
import ethUtil from "ethereumjs-util"

const JobsManager = artifacts.require("JobsManager")

const VERIFICATION_RATE = 1
const VERIFICATION_PERIOD = 50
const SLASHING_PERIOD = 50
const FAILED_VERIFICATION_SLASH_AMOUNT = 20
const MISSED_VERIFICATION_SLASH_AMOUNT = 30
const DOUBLE_CLAIM_SEGMENT_SLASH_AMOUNT = 40
const FINDER_FEE = 4

contract("JobsManager", accounts => {
    let fixture
    let jobsManager

    before(async () => {
        fixture = new Fixture(web3)
        await fixture.deployController()
        await fixture.deployMocks()

        jobsManager = await fixture.deployAndRegister(JobsManager, "JobsManager", fixture.controller.address)
        fixture.jobsManager = jobsManager
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("setParameters", () => {
        it("should set parameters", async () => {
            await jobsManager.setParameters(
                VERIFICATION_RATE,
                VERIFICATION_PERIOD,
                SLASHING_PERIOD,
                FAILED_VERIFICATION_SLASH_AMOUNT,
                MISSED_VERIFICATION_SLASH_AMOUNT,
                DOUBLE_CLAIM_SEGMENT_SLASH_AMOUNT,
                FINDER_FEE
            )

            const verificationRate = await jobsManager.verificationRate.call()
            assert.equal(verificationRate, VERIFICATION_RATE, "verification rate incorrect")
        })
    })

    describe("deposit", () => {
        const broadcaster = accounts[0]

        beforeEach(async () => {
            await jobsManager.setParameters(
                VERIFICATION_RATE,
                VERIFICATION_PERIOD,
                SLASHING_PERIOD,
                FAILED_VERIFICATION_SLASH_AMOUNT,
                MISSED_VERIFICATION_SLASH_AMOUNT,
                DOUBLE_CLAIM_SEGMENT_SLASH_AMOUNT,
                FINDER_FEE
            )
            await fixture.token.setApproved(true)
        })

        it("should update broadcaster deposit", async () => {
            await jobsManager.deposit(1000, {from: broadcaster})
            const bDeposit = (await jobsManager.broadcasters.call(broadcaster))[0]
            assert.equal(bDeposit, 1000, "broadcaster deposit incorrect")
        })
    })

    describe("job", () => {
        const broadcaster = accounts[0]
        const electedTranscoder = accounts[1]
        const streamId = "1"
        const transcodingOptions = createTranscodingOptions(["foo", "bar"])
        const maxPricePerSegment = 100

        beforeEach(async () => {
            await jobsManager.setParameters(
                VERIFICATION_RATE,
                VERIFICATION_PERIOD,
                SLASHING_PERIOD,
                FAILED_VERIFICATION_SLASH_AMOUNT,
                MISSED_VERIFICATION_SLASH_AMOUNT,
                DOUBLE_CLAIM_SEGMENT_SLASH_AMOUNT,
                FINDER_FEE
            )
            await fixture.bondingManager.setActiveTranscoder(electedTranscoder, maxPricePerSegment, 100, 200)
        })

        it("should create a NewJob event", async () => {
            const e = jobsManager.NewJob({})

            e.watch(async (err, result) => {
                e.stopWatching()

                assert.equal(result.args.broadcaster, broadcaster, "broadcaster incorrect")
                assert.equal(result.args.jobId, 0, "new job id incorrect")
                assert.equal(result.args.streamId, streamId, "stream id incorrect")
                assert.equal(result.args.transcodingOptions, transcodingOptions, "transcoding options incorrect")
            })

            const endBlock = web3.eth.blockNumber + 500
            await jobsManager.job(streamId, transcodingOptions, maxPricePerSegment, endBlock, {from: broadcaster})
        })

        it("should create a new job", async () => {
            const creationRound = 100
            await fixture.roundsManager.setCurrentRound(creationRound)

            const transcoderTotalStake = 100
            await fixture.bondingManager.setActiveTranscoder(accounts[1], 0, transcoderTotalStake, 0)

            const endBlock = web3.eth.blockNumber + 500
            const creationBlock = web3.eth.blockNumber + 1
            await jobsManager.job(streamId, transcodingOptions, maxPricePerSegment, endBlock, {from: broadcaster})

            const jInfo = await jobsManager.getJob(0)
            const jMaxPricePerSegment = jInfo[2]
            assert.equal(jMaxPricePerSegment, maxPricePerSegment, "max price per segment incorrect")
            const jBroadcasterAddress = jInfo[3]
            assert.equal(jBroadcasterAddress, broadcaster, "broadcaster address incorrect")
            const jCreationRound = jInfo[5]
            assert.equal(jCreationRound, creationRound, "creation round incorrect")
            const jCreationBlock = jInfo[6]
            assert.equal(jCreationBlock, creationBlock, "creation block incorrect")
            const jEndBlock = jInfo[7]
            assert.equal(jEndBlock, endBlock, "end block incorrect")
            const jEscrow = jInfo[8]
            assert.equal(jEscrow, 0, "escrow incorrect")
            const jTotalClaims = jInfo[9]
            assert.equal(jTotalClaims, 0, "total claims incorrect")
        })
    })

    describe("claimWork", () => {
        const broadcaster = accounts[0]
        const deposit = 1000

        const electedTranscoder = accounts[1]
        const streamId = "1"
        const transcodingOptions = createTranscodingOptions(["foo", "bar"])
        const maxPricePerSegment = 10
        const jobId = 0
        const segmentRange = [0, 3]
        const claimRoot = "0x1000000000000000000000000000000000000000000000000000000000000000"

        beforeEach(async () => {
            await jobsManager.setParameters(
                VERIFICATION_RATE,
                VERIFICATION_PERIOD,
                SLASHING_PERIOD,
                FAILED_VERIFICATION_SLASH_AMOUNT,
                MISSED_VERIFICATION_SLASH_AMOUNT,
                DOUBLE_CLAIM_SEGMENT_SLASH_AMOUNT,
                FINDER_FEE
            )
            await fixture.bondingManager.setActiveTranscoder(electedTranscoder, maxPricePerSegment, 100, 200)
            await fixture.token.setApproved(true)

            // Broadcaster deposits fees
            await jobsManager.deposit(deposit, {from: broadcaster})

            const endBlock0 = web3.eth.blockNumber + 400
            // Broadcaster creates job 0
            await jobsManager.job(streamId, transcodingOptions, maxPricePerSegment, endBlock0, {from: broadcaster})
            const endBlock1 = web3.eth.blockNumber + 20
            // Broadcaster creates job 1
            await jobsManager.job(streamId, transcodingOptions, maxPricePerSegment, endBlock1, {from: broadcaster})

            // Job 1 ends
            await fixture.rpc.wait(20)
        })

        it("should fail for invalid job id", async () => {
            const invalidJobId = 2
            // Transcoder claims work for invalid job id
            await expectThrow(jobsManager.claimWork(invalidJobId, segmentRange, claimRoot, {from: electedTranscoder}))
        })

        it("should fail for inactive job", async () => {
            const inactiveJobId = 1
            // Transcoder claims work for inactive job
            await expectThrow(jobsManager.claimWork(inactiveJobId, segmentRange, claimRoot, {from: electedTranscoder}))
        })

        it("should fail if the transcoder is assigned and the sender is not the assigned transcoder", async () => {
            await jobsManager.claimWork(jobId, segmentRange, claimRoot, {from: electedTranscoder})

            // Account 2 (not elected transcoder) claims work
            await expectThrow(jobsManager.claimWork(jobId, segmentRange, claimRoot, {from: accounts[2]}))
        })

        it("should fail if the transcoder is not assigned and it has been more than 256 blocks since the job creation block", async () => {
            const creationBlock = (await jobsManager.getJob(jobId))[6]
            await fixture.rpc.wait(256 - (web3.eth.blockNumber - creationBlock.toNumber()))

            await expectThrow(jobsManager.claimWork(jobId, segmentRange, claimRoot, {from: electedTranscoder}))
        })

        it("should fail if the sender should not be assigned the job", async () => {
            // Account 2 (not elected transcoder) claims work
            await expectThrow(jobsManager.claimWork(jobId, segmentRange, claimRoot, {from: accounts[2]}))
        })

        it("should create a NewClaim event", async () => {
            const e = jobsManager.NewClaim({})

            e.watch(async (err, result) => {
                e.stopWatching()

                assert.equal(result.args.transcoder, accounts[1], "transcoder incorrect")
                assert.equal(result.args.jobId, 0, "job id incorrect")
                assert.equal(result.args.claimId, 0, "claim id incorrect")
            })

            // Transcoder claims work
            await jobsManager.claimWork(jobId, segmentRange, claimRoot, {from: electedTranscoder})
        })

        it("should create claim for job", async () => {
            await jobsManager.claimWork(jobId, segmentRange, claimRoot, {from: electedTranscoder})

            const claimId = 0
            const claimBlock = web3.eth.blockNumber
            const verificationPeriod = await jobsManager.verificationPeriod.call()
            const slashingPeriod = await jobsManager.slashingPeriod.call()

            const cInfo = await jobsManager.getClaim(jobId, claimId)
            const cStartSegment = cInfo[0][0]
            assert.equal(cStartSegment, segmentRange[0], "segment range start incorrect")
            const cEndSegment = cInfo[0][1]
            assert.equal(cEndSegment, segmentRange[1], "segment range end incorrect")
            const cRoot = cInfo[1]
            assert.equal(cRoot, claimRoot, "claim root incorrect")
            const cBlock = cInfo[2]
            assert.equal(cBlock, claimBlock, "claim block incorrect")
            const cEndVerificationBlock = cInfo[3]
            assert.equal(cEndVerificationBlock, claimBlock + verificationPeriod.toNumber(), "end verification block incorrect")
            const cEndSlashingBlock = cInfo[4]
            assert.equal(cEndSlashingBlock, claimBlock + verificationPeriod.toNumber() + slashingPeriod.toNumber(), "end slashing block incorrect")
            const cStatus = cInfo[5]
            assert.equal(cStatus, 0, "claim status incorrect")
        })

        it("should update broadcaster deposit", async () => {
            await jobsManager.claimWork(jobId, segmentRange, claimRoot, {from: electedTranscoder})

            const fees = maxPricePerSegment * 2 * (segmentRange[1] - segmentRange[0] + 1)

            const jInfo = await jobsManager.getJob(jobId)
            const jEscrow = jInfo[8]
            assert.equal(jEscrow, fees, "escrow is incorrect")
        })

        it("should update job escrow", async () => {
            await jobsManager.claimWork(jobId, segmentRange, claimRoot, {from: electedTranscoder})

            const fees = maxPricePerSegment * 2 * (segmentRange[1] - segmentRange[0] + 1)
            const expDeposit = deposit - fees

            const newDeposit = (await jobsManager.broadcasters.call(broadcaster))[0]
            assert.equal(newDeposit, expDeposit, "deposit is incorrect")
        })
    })

    describe("verify", () => {
        const broadcaster = accounts[0]
        const electedTranscoder = accounts[1]
        const jobId = 0
        const claimId = 0
        const streamId = "1"
        const transcodingOptions = "0x123"
        const maxPricePerSegment = 10
        const segmentNumber = 0

        // Segment data hashes
        const dataHashes = [
            "0x80084bf2fba02475726feb2cab2d8215eab14bc6bdd8bfb2c8151257032ecd8b",
            "0xb039179a8a4ce2c252aa6f2f25798251c19b75fc1508d9d511a191e0487d64a7",
            "0x263ab762270d3b73d3e2cddf9acc893bb6bd41110347e5d5e4bd1d3c128ea90a",
            "0x4ce8765e720c576f6f5a34ca380b3de5f0912e6e3cc5355542c363891e54594b"
        ]

        // Segments
        const segments = dataHashes.map((dataHash, idx) => new Segment(streamId, idx, dataHash, broadcaster))

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
            await jobsManager.setParameters(
                VERIFICATION_RATE,
                VERIFICATION_PERIOD,
                SLASHING_PERIOD,
                FAILED_VERIFICATION_SLASH_AMOUNT,
                MISSED_VERIFICATION_SLASH_AMOUNT,
                DOUBLE_CLAIM_SEGMENT_SLASH_AMOUNT,
                FINDER_FEE
            )
            await fixture.bondingManager.setActiveTranscoder(electedTranscoder, maxPricePerSegment, 100, 200)
            await fixture.token.setApproved(true)

            await jobsManager.deposit(1000, {from: broadcaster})

            const endBlock0 = web3.eth.blockNumber + 500
            // Broadcaster creates job 0
            await jobsManager.job(streamId, transcodingOptions, maxPricePerSegment, endBlock0, {from: broadcaster})
            const endBlock1 = web3.eth.blockNumber + 20
            // Broadcaster creates another job 1
            await jobsManager.job(streamId, transcodingOptions, maxPricePerSegment, endBlock1, {from: broadcaster})

            // Broadcaster ends job 1
            await fixture.rpc.wait(20)

            const segmentRange = [0, 3]
            // Account 1 (transcoder) claims work for job 0
            await jobsManager.claimWork(jobId, segmentRange, merkleTree.getHexRoot(), {from: electedTranscoder})

            // Fast forward so that claimBlock + 1 is mined
            await fixture.rpc.wait(1)
        })

        it("should throw for insufficient payment for verification", async () => {
            await fixture.verifier.setPrice(10)
            // Transcoder calls verify with 0 payment
            await expectThrow(jobsManager.verify(jobId, claimId, segmentNumber, dataStorageHash, correctDataHashes, correctSig, correctProof, {from: electedTranscoder}))
        })

        it("should throw for invalid job id", async () => {
            const invalidJobId = 2
            // Transcoder calls verify with invalid job id
            await expectThrow(jobsManager.verify(invalidJobId, claimId, segmentNumber, dataStorageHash, correctDataHashes, correctSig, correctProof, {from: electedTranscoder}))
        })

        it("should throw for invalid claim id", async () => {
            const invalidClaimId = 1
            // Transcoder calls verify with invalid claim id
            await expectThrow(jobsManager.verify(jobId, invalidClaimId, segmentNumber, dataStorageHash, correctDataHashes, correctSig, correctProof, {from: electedTranscoder}))
        })

        it("should throw for inactive job", async () => {
            const inactiveJobId = 1
            // Transcoder calls verify with inactive job
            await expectThrow(jobsManager.verify(inactiveJobId, claimId, segmentNumber, dataStorageHash, correctDataHashes, correctSig, correctProof, {from: electedTranscoder}))
        })

        it("should throw if sender is not elected transcoder", async () => {
            // Account 2 (not elected transcoder) calls verify
            await expectThrow(jobsManager.verify(jobId, claimId, segmentNumber, dataStorageHash, correctDataHashes, correctSig, correctProof, {from: accounts[2]}))
        })

        it("should throw if segment is not eligible for verification", async () => {
            const invalidSegmentNumber = 99
            // Transcoder calls verify with invalid segment number
            await expectThrow(jobsManager.verify(jobId, claimId, invalidSegmentNumber, dataStorageHash, correctDataHashes, correctSig, correctProof, {from: electedTranscoder}))
        })

        it("should throw if segment not signed by broadcaster", async () => {
            const badSig = web3.eth.sign(accounts[3], ethUtil.bufferToHex(segments[0].hash()))
            // This should fail because badSig is signed by Account 3 and not the broadcaster
            await expectThrow(jobsManager.verify(jobId, claimId, segmentNumber, dataStorageHash, correctDataHashes, badSig, correctProof, {from: electedTranscoder}))
        })

        it("should throw if submitted Merkle proof is invalid", async () => {
            const badSig = ethUtil.bufferToHex(segments[3].signedHash())
            // This should fail because badSig is the sig for segment 3 but the receipt being verified is for segment 0
            await expectThrow(jobsManager.verify(jobId, claimId, segmentNumber, dataStorageHash, correctDataHashes, badSig, correctProof, {from: electedTranscoder}))
        })

        it("should not throw for successful verify call", async () => {
            // Set price to 100 wei
            await fixture.verifier.setPrice(100)
            // Transcoder calls verify with 100 wei payment
            await jobsManager.verify(jobId, claimId, segmentNumber, dataStorageHash, correctDataHashes, correctSig, correctProof, {from: electedTranscoder, value: 100})
        })
    })

    describe("distributeFees", () => {
        const broadcaster = accounts[0]
        const electedTranscoder = accounts[1]
        const jobId = 0
        const claimId = 0
        const maxPricePerSegment = 10

        beforeEach(async () => {
            await jobsManager.setParameters(
                VERIFICATION_RATE,
                VERIFICATION_PERIOD,
                SLASHING_PERIOD,
                FAILED_VERIFICATION_SLASH_AMOUNT,
                MISSED_VERIFICATION_SLASH_AMOUNT,
                DOUBLE_CLAIM_SEGMENT_SLASH_AMOUNT,
                FINDER_FEE
            )
            await fixture.bondingManager.setActiveTranscoder(electedTranscoder, maxPricePerSegment, 100, 200)
            await fixture.token.setApproved(true)

            await jobsManager.deposit(1000, {from: broadcaster})

            const streamId = "1"
            const transcodingOptions = createTranscodingOptions(["foo", "bar"])
            const endBlock = web3.eth.blockNumber + 500
            // Broadcaster creates job 0
            await jobsManager.job(streamId, transcodingOptions, maxPricePerSegment, endBlock, {from: broadcaster})

            // Wait for job creation block + 1 to be mined
            await fixture.rpc.wait(1)

            const segmentRange = [0, 3]
            const claimRoot = "0x1000000000000000000000000000000000000000000000000000000000000000"
            // Account 1 (transcoder) claims work for job 0
            await jobsManager.claimWork(jobId, segmentRange, claimRoot, {from: electedTranscoder})
        })

        it("should fail if verification period is not over", async () => {
            await expectThrow(jobsManager.distributeFees(jobId, claimId, {from: electedTranscoder}))
        })

        it("should fail if slashing period is not over", async () => {
            // Fast foward through verification period
            const verificationPeriod = await jobsManager.verificationPeriod.call()
            await fixture.rpc.wait(verificationPeriod.toNumber())

            await expectThrow(jobsManager.distributeFees(jobId, claimId, {from: electedTranscoder}))
        })

        it("should fail for invalid job id", async () => {
            // Fast foward through verificaiton and slashing period
            const verificationPeriod = await jobsManager.verificationPeriod.call()
            const slashingPeriod = await jobsManager.slashingPeriod.call()
            await fixture.rpc.wait(verificationPeriod.add(slashingPeriod).toNumber())

            const invalidJobId = 1
            await expectThrow(jobsManager.distributeFees(invalidJobId, claimId, {from: electedTranscoder}))
        })

        it("should fail for invalid claim id", async () => {
            // Fast foward through verificaiton and slashing period
            const verificationPeriod = await jobsManager.verificationPeriod.call()
            const slashingPeriod = await jobsManager.slashingPeriod.call()
            await fixture.rpc.wait(verificationPeriod.add(slashingPeriod).toNumber())

            const invalidClaimId = 1
            await expectThrow(jobsManager.distributeFees(jobId, invalidClaimId, {from: electedTranscoder}))
        })

        it("should fail if sender is not elected transcoder", async () => {
            // Fast foward through verificaiton and slashing period
            const verificationPeriod = await jobsManager.verificationPeriod.call()
            const slashingPeriod = await jobsManager.slashingPeriod.call()
            await fixture.rpc.wait(verificationPeriod.add(slashingPeriod).toNumber())

            // Should fail because account 2 is not the elected transcoder
            await expectThrow(jobsManager.distributeFees(jobId, claimId, {from: accounts[2]}))
        })

        it("should update job escrow and set claim as complete", async () => {
            // Fast foward through verificaiton and slashing period
            const verificationPeriod = await jobsManager.verificationPeriod.call()
            const slashingPeriod = await jobsManager.slashingPeriod.call()
            await fixture.rpc.wait(verificationPeriod.add(slashingPeriod).toNumber())

            await jobsManager.distributeFees(jobId, claimId, {from: electedTranscoder})

            const jInfo = await jobsManager.getJob(jobId)
            const jEscrow = jInfo[8]
            assert.equal(jEscrow, 0, "escrow is incorrect")
            const cInfo = await jobsManager.getClaim(jobId, claimId)
            const cStatus = cInfo[5]
            assert.equal(cStatus, 2, "claim status is incorrect")
        })

        it("should fail if claim is not pending", async () => {
            // Fast foward through verificaiton and slashing period
            const verificationPeriod = await jobsManager.verificationPeriod.call()
            const slashingPeriod = await jobsManager.slashingPeriod.call()
            await fixture.rpc.wait(verificationPeriod.add(slashingPeriod).toNumber())

            await jobsManager.distributeFees(jobId, claimId, {from: electedTranscoder})

            // Should fail because claim is already complete
            await expectThrow(jobsManager.distributeFees(jobId, claimId, {from: electedTranscoder}))
        })
    })

    describe("receiveVerification", () => {
        beforeEach(async () => {
            await jobsManager.setParameters(
                VERIFICATION_RATE,
                VERIFICATION_PERIOD,
                SLASHING_PERIOD,
                FAILED_VERIFICATION_SLASH_AMOUNT,
                MISSED_VERIFICATION_SLASH_AMOUNT,
                DOUBLE_CLAIM_SEGMENT_SLASH_AMOUNT,
                FINDER_FEE
            )
            await fixture.verifier.setVerifiable(jobsManager.address)
        })

        it("should fail if sender is not Verifier", async () => {
            const jobId = 0
            const claimId = 0
            const segmentNumber = 0
            const result = true

            // Non-verifier calls receiveVerification
            await expectThrow(jobsManager.receiveVerification(jobId, claimId, segmentNumber, result, {from: accounts[0]}))
        })

        it("should not fail if sender is Verifier", async () => {
            const jobId = 0
            const claimId = 0
            const segmentNumber = 0
            const result = true

            await fixture.verifier.setVerificationResult(jobId, claimId, segmentNumber, result)
            await fixture.verifier.callReceiveVerification()
        })
    })

    describe("batchDistributeFees", () => {
        const broadcaster = accounts[0]
        const electedTranscoder = accounts[1]
        const jobId = 0
        const claimIds = [0, 1]
        const maxPricePerSegment = 10

        beforeEach(async () => {
            await jobsManager.setParameters(
                VERIFICATION_RATE,
                VERIFICATION_PERIOD,
                SLASHING_PERIOD,
                FAILED_VERIFICATION_SLASH_AMOUNT,
                MISSED_VERIFICATION_SLASH_AMOUNT,
                DOUBLE_CLAIM_SEGMENT_SLASH_AMOUNT,
                FINDER_FEE
            )
            await fixture.bondingManager.setActiveTranscoder(electedTranscoder, maxPricePerSegment, 100, 200)
            await fixture.token.setApproved(true)

            await jobsManager.deposit(1000, {from: broadcaster})

            const streamId = "1"
            const transcodingOptions = createTranscodingOptions(["foo", "bar"])
            const endBlock = web3.eth.blockNumber + 500
            // Broadcaster creates job 0
            await jobsManager.job(streamId, transcodingOptions, maxPricePerSegment, endBlock, {from: broadcaster})

            // Wait for job creation block + 1 to be mined
            await fixture.rpc.wait(1)

            const segmentRange0 = [0, 3]
            const claimRoot = "0x1000000000000000000000000000000000000000000000000000000000000000"
            // Transcoder submits claim 0
            await jobsManager.claimWork(jobId, segmentRange0, claimRoot, {from: electedTranscoder})
            const segmentRange1 = [4, 7]
            // Transcoder submits claim 1
            await jobsManager.claimWork(jobId, segmentRange1, claimRoot, {from: electedTranscoder})
            const segmentRange2 = [8, 11]
            // Transcoder submits claim 2
            await jobsManager.claimWork(jobId, segmentRange2, claimRoot, {from: electedTranscoder})

            // Fast foward through verification period and slashing period
            const verificationPeriod = await jobsManager.verificationPeriod.call()
            const slashingPeriod = await jobsManager.slashingPeriod.call()
            await fixture.rpc.wait(verificationPeriod.add(slashingPeriod).toNumber())
        })

        it("should update job escrow and claim statuses multiple claims", async () => {
            await jobsManager.batchDistributeFees(jobId, claimIds, {from: electedTranscoder})

            const jInfo = await jobsManager.getJob(jobId)
            const jEscrow = jInfo[8]
            assert.equal(jEscrow, 80, "escrow is incorrect")

            const cInfo0 = await jobsManager.getClaim(jobId, 0)
            const cStatus0 = cInfo0[5]
            assert.equal(cStatus0, 2, "claim 0 status incorrect")
            const cInfo1 = await jobsManager.getClaim(jobId, 1)
            const cStatus1 = cInfo1[5]
            assert.equal(cStatus1, 2, "claim 1 status incorrect")
        })
    })

    describe("missedVerificationSlash", () => {
        const broadcaster = accounts[0]
        const electedTranscoder = accounts[1]
        const jobId = 0
        const claimId = 0
        const segmentNumber = 0
        const streamId = "1"
        const maxPricePerSegment = 10

        // Segment data hashes
        const dataHashes = [
            "0x80084bf2fba02475726feb2cab2d8215eab14bc6bdd8bfb2c8151257032ecd8b",
            "0xb039179a8a4ce2c252aa6f2f25798251c19b75fc1508d9d511a191e0487d64a7",
            "0x263ab762270d3b73d3e2cddf9acc893bb6bd41110347e5d5e4bd1d3c128ea90a",
            "0x4ce8765e720c576f6f5a34ca380b3de5f0912e6e3cc5355542c363891e54594b"
        ]

        // Segments
        const segments = dataHashes.map((dataHash, idx) => new Segment(streamId, idx, dataHash, broadcaster))

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
            await jobsManager.setParameters(
                VERIFICATION_RATE,
                VERIFICATION_PERIOD,
                SLASHING_PERIOD,
                FAILED_VERIFICATION_SLASH_AMOUNT,
                MISSED_VERIFICATION_SLASH_AMOUNT,
                DOUBLE_CLAIM_SEGMENT_SLASH_AMOUNT,
                FINDER_FEE
            )
            await fixture.bondingManager.setActiveTranscoder(electedTranscoder, maxPricePerSegment, 100, 200)
            await fixture.token.setApproved(true)

            await jobsManager.deposit(1000, {from: broadcaster})

            const transcodingOptions = createTranscodingOptions(["foo", "bar"])
            const endBlock = web3.eth.blockNumber + 500
            // Broadcaster creates job 0
            await jobsManager.job(streamId, transcodingOptions, maxPricePerSegment, endBlock, {from: broadcaster})

            // Wait for job creation block + 1 to be mined
            await fixture.rpc.wait(1)

            const segmentRange = [0, 3]
            // Account 1 (transcoder) claims work for job 0
            await jobsManager.claimWork(jobId, segmentRange, merkleTree.getHexRoot(), {from: electedTranscoder})
        })

        it("should throw if verification period is not over", async () => {
            await expectThrow(jobsManager.missedVerificationSlash(jobId, claimId, segmentNumber, {from: accounts[2]}))
        })

        it("should throw if segment is not eligible for verification", async () => {
            // Fast foward through verification period
            const verificationPeriod = await jobsManager.verificationPeriod.call()
            await fixture.rpc.wait(verificationPeriod.toNumber())

            const invalidSegmentNumber = 99
            await expectThrow(jobsManager.missedVerificationSlash(jobId, claimId, invalidSegmentNumber, {from: accounts[2]}))
        })

        it("should throw if slashing period is over", async () => {
            // Fast forward through slashing period
            const verificationPeriod = await jobsManager.verificationPeriod.call()
            const slashingPeriod = await jobsManager.slashingPeriod.call()
            await fixture.rpc.wait(verificationPeriod.add(slashingPeriod).toNumber())

            await expectThrow(jobsManager.missedVerificationSlash(jobId, claimId, segmentNumber, {from: accounts[2]}))
        })

        it("should throw if segment was verified", async () => {
            // Transcoder calls verify
            await jobsManager.verify(jobId, claimId, segmentNumber, dataStorageHash, correctDataHashes, correctSig, correctProof, {from: electedTranscoder})
            // Fast foward through verification period
            const verificationPeriod = await jobsManager.verificationPeriod.call()
            await fixture.rpc.wait(verificationPeriod.toNumber())

            await expectThrow(jobsManager.missedVerificationSlash(jobId, claimId, segmentNumber, {from: accounts[2]}))
        })

        it("should update job escrow, refund broadcaster deposit and set claim as slashed", async () => {
            // Fast foward through verification period
            const verificationPeriod = await jobsManager.verificationPeriod.call()
            await fixture.rpc.wait(verificationPeriod.toNumber())

            await jobsManager.missedVerificationSlash(jobId, claimId, segmentNumber, {from: accounts[2]})

            const jInfo = await jobsManager.getJob(jobId)
            const jEscrow = jInfo[8]
            assert.equal(jEscrow, 0, "escrow is incorrect")
            const bDeposit = (await jobsManager.broadcasters.call(broadcaster))[0]
            assert.equal(bDeposit, 1000, "broadcaster deposit is incorrect")
            const cInfo = await jobsManager.getClaim(jobId, claimId)
            const cStatus = cInfo[5]
            assert.equal(cStatus, 1, "claim status is incorrect")
        })

        it("should throw if claim is not pending", async () => {
            // Fast foward through verification period
            const verificationPeriod = await jobsManager.verificationPeriod.call()
            await fixture.rpc.wait(verificationPeriod.toNumber())

            await jobsManager.missedVerificationSlash(jobId, claimId, segmentNumber, {from: accounts[2]})

            // Should fail because claim is already slashed
            await expectThrow(jobsManager.missedVerificationSlash(jobId, claimId, segmentNumber, {from: accounts[2]}))
        })
    })

    describe("doubleClaimSegmentSlash", () => {
        const broadcaster = accounts[0]
        const electedTranscoder = accounts[1]
        const jobId = 0
        const streamId = "1"
        const maxPricePerSegment = 10

        beforeEach(async () => {
            await jobsManager.setParameters(
                VERIFICATION_RATE,
                VERIFICATION_PERIOD,
                SLASHING_PERIOD,
                FAILED_VERIFICATION_SLASH_AMOUNT,
                MISSED_VERIFICATION_SLASH_AMOUNT,
                DOUBLE_CLAIM_SEGMENT_SLASH_AMOUNT,
                FINDER_FEE
            )
            await fixture.bondingManager.setActiveTranscoder(electedTranscoder, maxPricePerSegment, 100, 200)
            await fixture.token.setApproved(true)

            await jobsManager.deposit(1000, {from: broadcaster})

            const transcodingOptions = createTranscodingOptions(["foo", "bar"])
            const endBlock = web3.eth.blockNumber + 500
            // Broadcaster creates job 0
            await jobsManager.job(streamId, transcodingOptions, maxPricePerSegment, endBlock, {from: broadcaster})

            // Wait for job creation block + 1 to be mined
            await fixture.rpc.wait(1)

            const segmentRange1 = [0, 3]
            const segmentRange2 = [2, 5]
            const root = "0x123"
            // Account 1 (transcoder) claims work for job 0
            await jobsManager.claimWork(jobId, segmentRange1, root, {from: electedTranscoder})
            // Account 1 (transcoder) double claims a segment for job 0
            await jobsManager.claimWork(jobId, segmentRange2, root, {from: electedTranscoder})
        })

        it("should fail if segment is not in claim 0", async () => {
            await expectThrow(jobsManager.doubleClaimSegmentSlash(0, 0, 1, 4, {from: accounts[3]}))
        })

        it("should fail if segment is not in claim 1", async () => {
            await expectThrow(jobsManager.doubleClaimSegmentSlash(0, 0, 1, 1), {from: accounts[3]})
        })

        it("should update job escrow and refund broadcaster for the entire job", async () => {
            await jobsManager.doubleClaimSegmentSlash(0, 0, 1, 3, {from: accounts[3]})

            const jInfo = await jobsManager.getJob(jobId)
            const jEscrow = jInfo[8]
            assert.equal(jEscrow, 0, "escrow is incorrect")
            const bDeposit = (await jobsManager.broadcasters.call(broadcaster))[0]
            assert.equal(bDeposit, 1000, "broadcaster deposit is incorrect")
            const c1Info = await jobsManager.getClaim(jobId, 0)
            const c1Status = c1Info[5]
            assert.equal(c1Status, 1, "claim 1 status is incorrect")
            const c2Info = await jobsManager.getClaim(jobId, 1)
            const c2Status = c2Info[5]
            assert.equal(c2Status, 1, "claim 2 status is incorrect")
        })
    })

    describe("withdraw", () => {
        beforeEach(async () => {
            await jobsManager.setParameters(
                VERIFICATION_RATE,
                VERIFICATION_PERIOD,
                SLASHING_PERIOD,
                FAILED_VERIFICATION_SLASH_AMOUNT,
                MISSED_VERIFICATION_SLASH_AMOUNT,
                DOUBLE_CLAIM_SEGMENT_SLASH_AMOUNT,
                FINDER_FEE
            )
            await fixture.bondingManager.setActiveTranscoder(accounts[1], 100, 100, 200)
            await fixture.token.setApproved(true)

            await jobsManager.deposit(1000, {from: accounts[0]})
        })

        it("should fail if the withdraw block is in the future", async () => {
            const endBlock = web3.eth.blockNumber + 50
            await jobsManager.job("abc", "abc", 100, endBlock, {from: accounts[0]})

            await expectThrow(jobsManager.withdraw({from: accounts[0]}))
        })

        it("should fail if withdraw block is updated to a block in the future", async () => {
            let endBlock = web3.eth.blockNumber + 50
            await jobsManager.job("abc", "abc", 100, endBlock, {from: accounts[0]})
            await fixture.rpc.wait(50)

            endBlock = web3.eth.blockNumber + 50
            await jobsManager.job("efg", "efg", 100, endBlock, {from: accounts[0]})

            await expectThrow(jobsManager.withdraw({from: accounts[0]}))
        })

        it("should succeed if the broadcaster has no active jobs and its withdraw block is in now or in the past", async () => {
            const endBlock = web3.eth.blockNumber + 50
            await jobsManager.job("abc", "abc", 100, endBlock, {from: accounts[0]})
            await fixture.rpc.wait(50)

            await jobsManager.withdraw({from: accounts[0]})
        })
    })
})
