import RPC from "../../utils/rpc"
import expectThrow from "../helpers/expectThrow"
import MerkleTree from "../../utils/merkleTree"
import abi from "ethereumjs-abi"
import utils from "ethereumjs-util"

var LivepeerProtocol = artifacts.require("LivepeerProtocol")
var LivepeerToken = artifacts.require("LivepeerToken")
var BondingManager = artifacts.require("BondingManager")
var RoundsManager = artifacts.require("RoundsManager")
var JobsManager = artifacts.require("JobsManager")
var IdentityVerifier = artifacts.require("IdentityVerifier")

const ROUND_LENGTH = 50
const NUM_ACTIVE_TRANSCODERS = 1
const VERIFICATION_PERIOD = 100
const JOB_ENDING_PERIOD = 100

contract("JobsManager", accounts => {
    let rpc
    let token
    let bondingManager
    let roundsManager
    let jobsManager

    const setup = async () => {
        rpc = new RPC(web3)

        // Start at new round
        await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH)

        token = await LivepeerToken.new()
        // Initial token distribution
        token.mint(accounts[0], 3000000000000000000, {from: accounts[0]})
        token.transfer(accounts[1], 500, {from: accounts[0]})

        bondingManager = await BondingManager.new(token.address, NUM_ACTIVE_TRANSCODERS)
        // Set BondingManager as token owner
        token.transferOwnership(bondingManager.address, {from: accounts[0]})

        roundsManager = await RoundsManager.new()

        const verifier = await IdentityVerifier.new()
        jobsManager = await JobsManager.new(verifier.address)

        const protocol = await LivepeerProtocol.new()
        const bondingManagerKey = await protocol.bondingManagerKey.call()
        const roundsManagerKey = await protocol.roundsManagerKey.call()
        const jobsManagerKey = await protocol.jobsManagerKey.call()

        await protocol.setRegistryContract(bondingManagerKey, bondingManager.address)
        await protocol.setRegistryContract(roundsManagerKey, roundsManager.address)
        await protocol.setRegistryContract(jobsManagerKey, jobsManager.address)
        await bondingManager.initialize(protocol.address)
        await roundsManager.initialize(protocol.address)
        await jobsManager.initialize(protocol.address)
    }

    describe("job", () => {
        before(async () => {
            await setup()

            const blockRewardCut = 10
            const feeShare = 5
            const pricePerSegment = 100

            // Account 0 => transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: accounts[0]})
            // Account 1 bonds to Account 0
            await token.approve(bondingManager.address, 100, {from: accounts[1]})
            await bondingManager.bond(100, accounts[0], {from: accounts[1]})
        })

        it("should create a new job", async () => {
            // Fast foward to next round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH)
            await roundsManager.initializeRound({from: accounts[0]})

            let e = jobsManager.NewJob({})

            e.watch(async (err, result) => {
                e.stopWatching()

                assert.equal(result.args.jobId, 0, "new job id incorrect")
                assert.equal(result.args.transcoder, accounts[0], "elected transcoder incorrect")
            })

            const streamId = "1"
            const dummyTranscodingOptions = "0x123"
            const maxPricePerSegment = 100

            // Account 2 creates job
            await jobsManager.job(streamId, dummyTranscodingOptions, maxPricePerSegment, {from: accounts[2]})
        })
    })

    describe("claimWork", () => {
        before(async () => {
            await setup()

            const blockRewardCut = 10
            const feeShare = 5
            const pricePerSegment = 100

            // Account 0 => transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: accounts[0]})
            // Account 1 bonds to Account 0
            await token.approve(bondingManager.address, 100, {from: accounts[1]})
            await bondingManager.bond(100, accounts[0], {from: accounts[1]})

            // Fast foward to next round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH)
            await roundsManager.initializeRound({from: accounts[0]})

            const streamId = "1"
            const dummyTranscodingOptions = "0x123"
            const maxPricePerSegment = 100

            // Account 2 creates job 0
            await jobsManager.job(streamId, dummyTranscodingOptions, maxPricePerSegment, {from: accounts[2]})

            // Account 2 creates another job 1
            await jobsManager.job(streamId, dummyTranscodingOptions, maxPricePerSegment, {from: accounts[2]})

            // Account 2 ends job 1
            await jobsManager.endJob(1, {from: accounts[2]})

            // Fast foward through job ending period
            await rpc.wait(20, JOB_ENDING_PERIOD)
        })

        it("should throw for invalid job id", async () => {
            const jobId = 2
            const dummyTranscodeClaimsRoot = "0x1000000000000000000000000000000000000000000000000000000000000000"
            // Account 0 claims work for job 2 (invalid job id)
            await expectThrow(jobsManager.claimWork(jobId, 0, 10, dummyTranscodeClaimsRoot, {from: accounts[0]}))
        })

        it("should throw for inactive job", async () => {
            const jobId = 1
            const dummyTranscodeClaimsRoot = "0x1000000000000000000000000000000000000000000000000000000000000000"
            // Account 0 claims work for job 1 (inactive job)
            await expectThrow(jobsManager.claimWork(jobId, 0, 10, dummyTranscodeClaimsRoot, {from: accounts[0]}))
        })

        it("should throw if sender is not assigned transcoder", async () => {
            const jobId = 0
            const dummyTranscodeClaimsRoot = "0x1000000000000000000000000000000000000000000000000000000000000000"
            // Account 3 (not elected transcoder) claims work
            await expectThrow(jobsManager.claimWork(jobId, 0, 10, dummyTranscodeClaimsRoot, {from: accounts[3]}))
        })

        it("should set transcode claims details for job", async () => {
            const jobId = 0
            const dummyTranscodeClaimsRoot = "0x1000000000000000000000000000000000000000000000000000000000000000"
            // Account 0 claims work
            await jobsManager.claimWork(jobId, 0, 10, dummyTranscodeClaimsRoot, {from: accounts[0]})

            const claimWorkBlock = web3.eth.blockNumber
            const transcodeClaimsDetails = await jobsManager.getJobTranscodeClaimsDetails(jobId)
            assert.equal(transcodeClaimsDetails[0], claimWorkBlock, "last claimed work block incorrect")
            assert.equal(transcodeClaimsDetails[1], claimWorkBlock + VERIFICATION_PERIOD,"end verification block incorrect")
            assert.equal(transcodeClaimsDetails[2], 0, "start segment sequence number incorrect")
            assert.equal(transcodeClaimsDetails[3], 10, "end segment sequence number incorrect")
            assert.equal(transcodeClaimsDetails[4], dummyTranscodeClaimsRoot, "transcode claims root incorrect")
        })

        it("should throw if previous verification period is not over", async () => {
            const jobId = 0
            const dummyTranscodeClaimsRoot = "0x1000000000000000000000000000000000000000000000000000000000000000"
            // Account 0 claims work again
            await expectThrow(jobsManager.claimWork(jobId, 11, 20, dummyTranscodeClaimsRoot, {from: accounts[0]}))
        })
    })

    describe("verify", () => {
        const streamId = "1"
        const dummyTranscodingOptions = "0x123"
        const maxPricePerSegment = 100

        // Segment data hashes
        const d0 = Buffer.from("80084bf2fba02475726feb2cab2d8215eab14bc6bdd8bfb2c8151257032ecd8b", "hex");
        const d1 = Buffer.from("b039179a8a4ce2c252aa6f2f25798251c19b75fc1508d9d511a191e0487d64a7", "hex");
        const d2 = Buffer.from("263ab762270d3b73d3e2cddf9acc893bb6bd41110347e5d5e4bd1d3c128ea90a", "hex");
        const d3 = Buffer.from("4ce8765e720c576f6f5a34ca380b3de5f0912e6e3cc5355542c363891e54594b", "hex");

        // Segment hashes (streamId, segmentSequenceNumber, dataHash)
        const s0 = abi.soliditySHA3(["string", "uint256", "bytes"], [streamId, 0, d0]);
        const s1 = abi.soliditySHA3(["string", "uint256", "bytes"], [streamId, 1, d1]);
        const s2 = abi.soliditySHA3(["string", "uint256", "bytes"], [streamId, 2, d2]);
        const s3 = abi.soliditySHA3(["string", "uint256", "bytes"], [streamId, 3, d3]);

        // Transcoded data hashes
        const tD0 = Buffer.from("42538602949f370aa331d2c07a1ee7ff26caac9cc676288f94b82eb2188b8465", "hex");
        const tD1 = Buffer.from("a0b37b8bfae8e71330bd8e278e4a45ca916d00475dd8b85e9352533454c9fec8", "hex");
        const tD2 = Buffer.from("9f2898da52dedaca29f05bcac0c8e43e4b9f7cb5707c14cc3f35a567232cec7c", "hex");
        const tD3 = Buffer.from("5a082c81a7e4d5833ee20bd67d2f4d736f679da33e4bebd3838217cb27bec1d3", "hex");

        // Broadcaster signatures over segments
        let bSig0
        let bSig1
        let bSig2
        let bSig3

        // Transcode claims
        let tClaim0
        let tClaim1
        let tClaim2
        let tClaim3

        let root
        let proof

        before(async () => {
            await setup()

            const blockRewardCut = 10
            const feeShare = 5
            const pricePerSegment = 100

            // Account 0 => transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: accounts[0]})
            // Account 1 bonds to Account 0
            await token.approve(bondingManager.address, 100, {from: accounts[1]})
            await bondingManager.bond(100, accounts[0], {from: accounts[1]})

            // Fast foward to next round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH)
            await roundsManager.initializeRound({from: accounts[0]})

            // Account 2 creates job 0
            await jobsManager.job(streamId, dummyTranscodingOptions, maxPricePerSegment, {from: accounts[2]})

            // Account 2 creates another job 1
            await jobsManager.job(streamId, dummyTranscodingOptions, maxPricePerSegment, {from: accounts[2]})

            // Account 2 ends job 1
            await jobsManager.endJob(1, {from: accounts[2]})

            // Fast foward through job ending period
            await rpc.wait(20, JOB_ENDING_PERIOD)

            bSig0 = utils.toBuffer(web3.eth.sign(accounts[2], utils.bufferToHex(s0)));
            bSig1 = utils.toBuffer(web3.eth.sign(accounts[2], utils.bufferToHex(s1)));
            bSig2 = utils.toBuffer(web3.eth.sign(accounts[2], utils.bufferToHex(s2)));
            bSig3 = utils.toBuffer(web3.eth.sign(accounts[2], utils.bufferToHex(s3)));

            tClaim0 = abi.soliditySHA3(["string", "uint256", "bytes", "bytes", "bytes"], [streamId, 0, d0, tD0, bSig0]);
            tClaim1 = abi.soliditySHA3(["string", "uint256", "bytes", "bytes", "bytes"], [streamId, 1, d1, tD1, bSig1]);
            tClaim2 = abi.soliditySHA3(["string", "uint256", "bytes", "bytes", "bytes"], [streamId, 2, d2, tD2, bSig2]);
            tClaim3 = abi.soliditySHA3(["string", "uint256", "bytes", "bytes", "bytes"], [streamId, 3, d3, tD3, bSig3]);

            // Generate Merkle root
            const merkleTree = new MerkleTree([tClaim0, tClaim1, tClaim2, tClaim3])
            root = merkleTree.getHexRoot()
            proof = merkleTree.getHexProof(tClaim0)

            // Account 0 (transcoder) claims work for job 0
            await jobsManager.claimWork(0, 0, 3, root, {from: accounts[0]})
        })

        it("should throw for invalid job id", async () => {
            const jobId = 2
            const segmentSequenceNumber = 0
            // Account 0 calls verify with job 2 (invalid job id)
            await expectThrow(jobsManager.verify(jobId, segmentSequenceNumber, utils.bufferToHex(d0), utils.bufferToHex(tD0), utils.bufferToHex(bSig0), proof, {from: accounts[0]}))
        })

        it("should throw for inactive job", async () => {
            const jobId = 1
            const segmentSequenceNumber = 0
            // Account 0 calls verify with job 1 (inactive job)
            await expectThrow(jobsManager.verify(jobId, segmentSequenceNumber, utils.bufferToHex(d0), utils.bufferToHex(tD0), utils.bufferToHex(bSig0), proof, {from: accounts[0]}))
        })

        it("should throw if sender is not assigned transcoder", async () => {
            const jobId = 0
            const segmentSequenceNumber = 0
            // Account 3 (not elected transcoder) calls verify with job 0
            await expectThrow(jobsManager.verify(jobId, segmentSequenceNumber, utils.bufferToHex(d0), utils.bufferToHex(tD0), utils.bufferToHex(bSig0), proof, {from: accounts[3]}))
        })

        it("should throw if segment is not eligible for verification", async () => {
            const jobId = 0
            const segmentSequenceNumber = 99
            // Account 0 calls verify with job 0 and segment sequence number 99 (not eligible for verification)
            await expectThrow(jobsManager.verify(jobId, segmentSequenceNumber, utils.bufferToHex(d0), utils.bufferToHex(tD0), utils.bufferToHex(bSig0), proof, {from: accounts[0]}))
        })

        it("should throw if segment not signed by broadcaster", async () => {
            const jobId = 0
            const segmentSequenceNumber = 0
            const badBSig0 = utils.toBuffer(web3.eth.sign(accounts[3], utils.bufferToHex(s0)));
            // Account 0 calls verify with job 0
            // This should fail because badBSig0 is signed by Account 3 and not the broadcaster Account 2
            await expectThrow(jobsManager.verify(jobId, segmentSequenceNumber, utils.bufferToHex(d0), utils.bufferToHex(tD0), utils.bufferToHex(badBSig0), proof, {from: accounts[0]}))
        })

        it("should throw if submitted Merkle proof is invalid", async () => {
            const jobId = 0
            const segmentSequenceNumber = 0
            // Account 0 calls verify with job 0
            // This should fail because bSig3 is submitted instead of bSig0 which is part of the transcode claim tClaim0 being verified
            await expectThrow(jobsManager.verify(jobId, segmentSequenceNumber, utils.bufferToHex(d0), utils.bufferToHex(tD0), utils.bufferToHex(bSig3), proof, {from: accounts[0]}))
        })

        it("should not throw with valid parameters", async () => {
            const jobId = 0
            const segmentSequenceNumber = 0
            // Account 0 calls verify with job 0
            await jobsManager.verify(jobId, segmentSequenceNumber, utils.bufferToHex(d0), utils.bufferToHex(tD0), utils.bufferToHex(bSig0), proof, {from: accounts[0]})
        })
    })

    describe("receiveVerification", () => {
        before(async () => {
            await setup()
        })

        it("should throw if sender is not Verifier", async () => {
            const jobId = 0
            const segmentSequenceNumber = 0
            const result = true

            // Account 0 (not Verifier) calls receiveVerification
            await expectThrow(jobsManager.receiveVerification(jobId, segmentSequenceNumber, result, {from: accounts[0]}))
        })
    })

    describe("getters", () => {
        const streamId = "1"
        const dummyTranscodingOptions = "abc123"
        const maxPricePerSegment = 100

        before(async () => {
            await setup()

            const blockRewardCut = 10
            const feeShare = 5
            const pricePerSegment = 100

            // Account 0 => transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: accounts[0]})
            // Account 1 bonds to Account 0
            await token.approve(bondingManager.address, 100, {from: accounts[1]})
            await bondingManager.bond(100, accounts[0], {from: accounts[1]})

            // Fast foward to next round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH)
            await roundsManager.initializeRound({from: accounts[0]})

            // Account 2 creates job
            await jobsManager.job(streamId, dummyTranscodingOptions, maxPricePerSegment, {from: accounts[2]})
        })

        describe("getJobDetails", () => {
            it("should return job details", async () => {
                const jobId = 0
                const job = await jobsManager.getJobDetails(jobId)

                assert.equal(job[0], jobId, "job id incorrect")
                assert.equal(job[1], maxPricePerSegment, "max price per segment incorrect")
                assert.equal(job[2], accounts[2], "broadcaster address incorrect")
                assert.equal(job[3], accounts[0], "transcoder address incorrect")
            })
        })

        describe("getJobStreamId", () => {
            it("should return job stream id", async () => {
                const jobId = 0
                const jobStreamId = await jobsManager.getJobStreamId(jobId)

                assert.equal(jobStreamId, streamId, "stream id incorrect")
            })
        })

        describe("getJobTranscodingOptions", () => {
            it("should return job transcoding options", async () => {
                const jobId = 0
                const jobTranscodingOptions = await jobsManager.getJobTranscodingOptions(jobId)

                assert.equal(jobTranscodingOptions, dummyTranscodingOptions, "transcoding options incorrect")
            })
        })
    })
})
