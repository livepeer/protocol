import expectThrow from "../helpers/expectThrow"
import RPC from "../../utils/rpc"
import MerkleTree from "../../utils/merkleTree"
import ethUtil from "ethereumjs-util"
import ethAbi from "ethereumjs-abi"

const LivepeerProtocol = artifacts.require("LivepeerProtocol")
const LivepeerToken = artifacts.require("LivepeerToken")
const JobsManager = artifacts.require("JobsManager")
const IdentityVerifier = artifacts.require("IdentityVerifier")
const BondingManagerMock = artifacts.require("BondingManagerMock")

contract("JobsManager", accounts => {
    let rpc
    let token
    let bondingManager
    let jobsManager

    const setup = async () => {
        rpc = new RPC(web3)

        token = await LivepeerToken.new()
        // Initial token distribution
        token.mint(accounts[0], 3000000000000000000, {from: accounts[0]})

        const protocol = await LivepeerProtocol.new()

        bondingManager = await BondingManagerMock.new(protocol.address, accounts[1])
        await protocol.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["BondingManager"])), bondingManager.address)

        const verifier = await IdentityVerifier.new()
        jobsManager = await JobsManager.new(protocol.address, token.address, verifier.address)
    }

    describe("deposit", () => {
        const broadcaster = accounts[0]

        before(async () => {
            await setup()
        })

        it("should update broadcaster deposit", async () => {
            await token.approve(jobsManager.address, 1000, {from: broadcaster})
            await jobsManager.deposit(1000, {from: broadcaster})

            assert.equal(await jobsManager.broadcasterDeposits.call(broadcaster), 1000, "broadcaster deposit incorrect")
        })
    })

    describe("job", () => {
        const broadcaster = accounts[0]
        const electedTranscoder = accounts[1]
        const streamId = "1"
        const dummyTranscodingOptions = "0x123"
        const maxPricePerSegment = 100

        before(async () => {
            await setup()
        })

        it("should create a NewJob event", async () => {
            const e = jobsManager.NewJob({})

            e.watch(async (err, result) => {
                e.stopWatching()

                assert.equal(result.args.transcoder, electedTranscoder, "elected transcoder incorrect")
                assert.equal(result.args.broadcaster, broadcaster, "broadcaster incorrect")
                assert.equal(result.args.jobId, 0, "new job id incorrect")
            })

            // Account 1 creates job
            await jobsManager.job(streamId, dummyTranscodingOptions, maxPricePerSegment, {from: broadcaster})
        })

        it("should create a new job", async () => {
            const jobId = 0
            const job = await jobsManager.jobs.call(jobId)

            assert.equal(job[0], jobId, "job id incorrect")
            assert.equal(job[1], streamId, "stream id incorrect")
            assert.equal(job[2], dummyTranscodingOptions, "transcoding options incorrect")
            assert.equal(job[3], maxPricePerSegment, "max price per segment incorrect")
            assert.equal(job[4], broadcaster, "broadcaster incorrect")
            assert.equal(job[5], electedTranscoder, "transcoder incorrect")
            assert.equal(job[6], 0, "end block incorrect")
            assert.equal(job[7], 0, "escrow incorrect")
        })
    })

    describe("claimWork", () => {
        const broadcaster = accounts[0]
        const electedTranscoder = accounts[1]
        const jobId = 0
        const segmentRange = [0, 3]
        const dummyClaimRoot = "0x1000000000000000000000000000000000000000000000000000000000000000"

        before(async () => {
            await setup()

            // Broadcaster deposits fees
            await token.approve(jobsManager.address, 1000, {from: broadcaster})
            await jobsManager.deposit(1000, {from: broadcaster})

            const streamId = "1"
            const dummyTranscodingOptions = "0x123"
            const maxPricePerSegment = 10
            // Broadcaster creates job 0
            await jobsManager.job(streamId, dummyTranscodingOptions, maxPricePerSegment, {from: broadcaster})
            // Broadcaster creates job 1
            await jobsManager.job(streamId, dummyTranscodingOptions, maxPricePerSegment, {from: broadcaster})

            // Broadcaster ends job 1
            await jobsManager.endJob(1, {from: broadcaster})

            const jobEndingPeriod = await jobsManager.jobEndingPeriod.call()
            // Fast foward through job ending period
            await rpc.wait(20, jobEndingPeriod.toNumber())
        })

        it("should throw for invalid job id", async () => {
            const invalidJobId = 2
            // Transcoder claims work for invalid job id
            await expectThrow(jobsManager.claimWork(invalidJobId, segmentRange, dummyClaimRoot, {from: electedTranscoder}))
        })

        it("should throw for inactive job", async () => {
            const inactiveJobId = 1
            // Transcoder claims work for inactive job
            await expectThrow(jobsManager.claimWork(inactiveJobId, segmentRange, dummyClaimRoot, {from: electedTranscoder}))
        })

        it("should throw if sender is not elected transcoder", async () => {
            // Account 2 (not elected transcoder) claims work
            await expectThrow(jobsManager.claimWork(jobId, segmentRange, dummyClaimRoot, {from: accounts[2]}))
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
            await jobsManager.claimWork(jobId, segmentRange, dummyClaimRoot, {from: electedTranscoder})
        })

        it("should create claim for job", async () => {
            const claimId = 0
            const claimBlock = web3.eth.blockNumber
            const verificationPeriod = await jobsManager.verificationPeriod.call()
            const slashingPeriod = await jobsManager.slashingPeriod.call()
            const transcoderTotalStake = await bondingManager.transcoderTotalStake(accounts[1])

            const claimDetails = await jobsManager.getClaimDetails(jobId, claimId)
            assert.equal(claimDetails[0][0], segmentRange[0], "segment range start incorrect")
            assert.equal(claimDetails[0][1], segmentRange[1], "segment range end incorrect")
            assert.equal(claimDetails[1], dummyClaimRoot, "claim root incorrect")
            assert.equal(claimDetails[2], claimBlock, "claim block incorrect")
            assert.equal(claimDetails[3], claimBlock + verificationPeriod.toNumber(), "end verification block incorrect")
            assert.equal(claimDetails[4], claimBlock + verificationPeriod.toNumber() + slashingPeriod.toNumber(), "end slashing block incorrect")
            assert.equal(claimDetails[5], transcoderTotalStake.toNumber(), "transcoder total stake incorrect")
        })

        it("should update broadcaster deposit", async () => {
            const job = await jobsManager.jobs.call(jobId)
            assert.equal(job[7], 30, "escrow is incorrect")
        })

        it("should update job escrow", async () => {
            const deposit = await jobsManager.broadcasterDeposits.call(broadcaster)
            assert.equal(deposit, 970, "deposit is incorrect")
        })
    })

    describe("verify", () => {
        const broadcaster = accounts[0]
        const electedTranscoder = accounts[1]
        const jobId = 0
        const claimId = 0
        const streamId = "1"
        const segmentNumber = 0

        // Segment data hashes
        const d0 = "0x80084bf2fba02475726feb2cab2d8215eab14bc6bdd8bfb2c8151257032ecd8b"
        const d1 = "0xb039179a8a4ce2c252aa6f2f25798251c19b75fc1508d9d511a191e0487d64a7"
        const d2 = "0x263ab762270d3b73d3e2cddf9acc893bb6bd41110347e5d5e4bd1d3c128ea90a"
        const d3 = "0x4ce8765e720c576f6f5a34ca380b3de5f0912e6e3cc5355542c363891e54594b"

        // Segment hashes (streamId, segmentSequenceNumber, dataHash)
        const s0 = ethAbi.soliditySHA3(["string", "uint256", "string"], [streamId, 0, d0])
        const s1 = ethAbi.soliditySHA3(["string", "uint256", "string"], [streamId, 1, d1])
        const s2 = ethAbi.soliditySHA3(["string", "uint256", "string"], [streamId, 2, d2])
        const s3 = ethAbi.soliditySHA3(["string", "uint256", "string"], [streamId, 3, d3])

        // Transcoded data hashes
        const tD0 = "0x42538602949f370aa331d2c07a1ee7ff26caac9cc676288f94b82eb2188b8465"
        const tD1 = "0xa0b37b8bfae8e71330bd8e278e4a45ca916d00475dd8b85e9352533454c9fec8"
        const tD2 = "0x9f2898da52dedaca29f05bcac0c8e43e4b9f7cb5707c14cc3f35a567232cec7c"
        const tD3 = "0x5a082c81a7e4d5833ee20bd67d2f4d736f679da33e4bebd3838217cb27bec1d3"

        // Broadcaster signatures over segments
        const bSig0 = ethUtil.toBuffer(web3.eth.sign(broadcaster, ethUtil.bufferToHex(s0)))
        const bSig1 = ethUtil.toBuffer(web3.eth.sign(broadcaster, ethUtil.bufferToHex(s1)))
        const bSig2 = ethUtil.toBuffer(web3.eth.sign(broadcaster, ethUtil.bufferToHex(s2)))
        const bSig3 = ethUtil.toBuffer(web3.eth.sign(broadcaster, ethUtil.bufferToHex(s3)))

        // Transcode receipts
        const tReceipt0 = ethAbi.soliditySHA3(["string", "uint256", "string", "string", "bytes"], [streamId, 0, d0, tD0, bSig0])
        const tReceipt1 = ethAbi.soliditySHA3(["string", "uint256", "string", "string", "bytes"], [streamId, 1, d1, tD1, bSig1])
        const tReceipt2 = ethAbi.soliditySHA3(["string", "uint256", "string", "string", "bytes"], [streamId, 2, d2, tD2, bSig2])
        const tReceipt3 = ethAbi.soliditySHA3(["string", "uint256", "string", "string", "bytes"], [streamId, 3, d3, tD3, bSig3])

        // Build merkle tree
        const merkleTree = new MerkleTree([tReceipt0, tReceipt1, tReceipt2, tReceipt3])

        before(async () => {
            await setup()

            // Broadcaster deposits fees
            await token.approve(jobsManager.address, 1000, {from: broadcaster})
            await jobsManager.deposit(1000, {from: broadcaster})

            const dummyTranscodingOptions = "0x123"
            const maxPricePerSegment = 10
            // Broadcaster creates job 0
            await jobsManager.job(streamId, dummyTranscodingOptions, maxPricePerSegment, {from: broadcaster})
            // Broadcaster creates another job 1
            await jobsManager.job(streamId, dummyTranscodingOptions, maxPricePerSegment, {from: broadcaster})

            // Broadcaster ends job 1
            await jobsManager.endJob(1, {from: broadcaster})

            const jobEndingPeriod = await jobsManager.jobEndingPeriod.call()
            // Fast foward through job ending period
            await rpc.wait(20, jobEndingPeriod.toNumber())

            const segmentRange = [0, 3]
            // Account 1 (transcoder) claims work for job 0
            await jobsManager.claimWork(jobId, segmentRange, merkleTree.getHexRoot(), {from: electedTranscoder})
        })

        it("should throw for invalid job id", async () => {
            const invalidJobId = 2
            // Transcoder calls verify with invalid job id
            await expectThrow(jobsManager.verify(invalidJobId, claimId, segmentNumber, d0, tD0, ethUtil.bufferToHex(bSig0), merkleTree.getHexProof(tReceipt0), {from: electedTranscoder}))
        })

        it("should throw for invalid claim id", async () => {
            const invalidClaimId = 1
            // Transcoder calls verify with invalid claim id
            await expectThrow(jobsManager.verify(jobId, invalidClaimId, segmentNumber, d0, tD0, ethUtil.bufferToHex(bSig0), merkleTree.getHexRoot(tReceipt0), {from: electedTranscoder}))
        })

        it("should throw for inactive job", async () => {
            const inactiveJobId = 1
            // Transcoder calls verify with inactive job
            await expectThrow(jobsManager.verify(inactiveJobId, claimId, segmentNumber, d0, tD0, ethUtil.bufferToHex(bSig0), merkleTree.getHexProof(tReceipt0), {from: electedTranscoder}))
        })

        it("should throw if sender is not elected transcoder", async () => {
            // Account 2 (not elected transcoder) calls verify
            await expectThrow(jobsManager.verify(jobId, claimId, segmentNumber, d0, tD0, ethUtil.bufferToHex(bSig0), merkleTree.getHexProof(tReceipt0), {from: accounts[2]}))
        })

        it("should throw if segment is not eligible for verification", async () => {
            const invalidSegmentNumber = 99
            // Transcoder calls verify with invalid segment number
            await expectThrow(jobsManager.verify(jobId, claimId, invalidSegmentNumber, d0, tD0, ethUtil.bufferToHex(bSig0), merkleTree.getHexProof(tReceipt0), {from: electedTranscoder}))
        })

        it("should throw if segment not signed by broadcaster", async () => {
            const badBSig0 = ethUtil.toBuffer(web3.eth.sign(accounts[3], ethUtil.bufferToHex(s0)))
            // This should fail because badBSig0 is signed by Account 3 and not the broadcaster
            await expectThrow(jobsManager.verify(jobId, claimId, segmentNumber, d0, tD0, ethUtil.bufferToHex(badBSig0), merkleTree.getHexProof(tReceipt0), {from: electedTranscoder}))
        })

        it("should throw if submitted Merkle proof is invalid", async () => {
            // This should fail because bSig3 is submitted instead of bSig0 which is part of the transcode receipt tReceipt0 being verified
            await expectThrow(jobsManager.verify(jobId, claimId, segmentNumber, d0, tD0, ethUtil.bufferToHex(bSig3), merkleTree.getHexProof(tReceipt0), {from: electedTranscoder}))
        })

        it("should not throw for successful verify call", async () => {
            // Transcoder calls verify
            await jobsManager.verify(jobId, claimId, segmentNumber, d0, tD0, ethUtil.bufferToHex(bSig0), merkleTree.getHexProof(tReceipt0), {from: electedTranscoder})
        })
    })

    describe("distributeFees", () => {
        const broadcaster = accounts[0]
        const electedTranscoder = accounts[1]
        const jobId = 0
        const claimId = 0

        before(async () => {
            await setup()

            // Broadcaster deposits fees
            await token.approve(jobsManager.address, 1000, {from: broadcaster})
            await jobsManager.deposit(1000, {from: broadcaster})

            const streamId = "1"
            const dummyTranscodingOptions = "0x123"
            const maxPricePerSegment = 10
            // Broadcaster creates job 0
            await jobsManager.job(streamId, dummyTranscodingOptions, maxPricePerSegment, {from: broadcaster})

            const segmentRange = [0, 3]
            const dummyClaimRoot = "0x1000000000000000000000000000000000000000000000000000000000000000"
            // Transcoder claims work for job 0
            await jobsManager.claimWork(jobId, segmentRange, dummyClaimRoot, {from: electedTranscoder})

            // Fast foward through verification period
            const verificationPeriod = await jobsManager.verificationPeriod.call()
            await rpc.wait(20, verificationPeriod.toNumber())
        })

        it("should throw if slashing period is not over", async () => {
            await expectThrow(jobsManager.distributeFees(jobId, claimId, {from: electedTranscoder}))
        })

        it("should throw for invalid job id", async () => {
            // Fast foward through slashing period
            const slashingPeriod = await jobsManager.slashingPeriod.call()
            await rpc.wait(20, slashingPeriod.toNumber())

            const invalidJobId = 1
            await expectThrow(jobsManager.distributeFees(invalidJobId, claimId, {from: electedTranscoder}))
        })

        it("should throw for invalid claim id", async () => {
            const invalidClaimId = 1
            await expectThrow(jobsManager.distributeFees(jobId, invalidClaimId, {from: electedTranscoder}))
        })

        it("should throw if sender is not elected transcoder", async () => {
            // Should fail because account 2 is not the elected transcoder
            await expectThrow(jobsManager.distributeFees(jobId, claimId, {from: accounts[2]}))
        })

        it("should update job escrow", async () => {
            await jobsManager.distributeFees(jobId, claimId, {from: electedTranscoder})

            const job = await jobsManager.jobs.call(jobId)
            assert.equal(job[7], 0, "escrow is incorrect")
        })

        it("should set claim as complete", async () => {
            const claim = await jobsManager.getClaimDetails(jobId, claimId)
            assert.equal(claim[6], 2, "claim status is incorrect")
        })

        it("should throw if claim is not pending", async () => {
            // Should fail because claim is already complete
            await expectThrow(jobsManager.distributeFees(jobId, claimId, {from: electedTranscoder}))
        })
    })

    describe("receiveVerification", () => {
        before(async () => {
            await setup()
        })

        it("should throw if sender is not Verifier", async () => {
            const jobId = 0
            const segmentNumber = 0
            const result = true

            // Non-verifier calls receiveVerification
            await expectThrow(jobsManager.receiveVerification(jobId, segmentNumber, result, {from: accounts[0]}))
        })
    })

    describe("batchDistributeFees", () => {
        const broadcaster = accounts[0]
        const electedTranscoder = accounts[1]
        const jobId = 0
        const claimIds = [0, 1]

        before(async () => {
            await setup()

            // Broadcaster deposits fees
            await token.approve(jobsManager.address, 1000, {from: broadcaster})
            await jobsManager.deposit(1000, {from: broadcaster})

            const streamId = "1"
            const dummyTranscodingOptions = "0x123"
            const maxPricePerSegment = 10
            // Broadcaster creates job 0
            await jobsManager.job(streamId, dummyTranscodingOptions, maxPricePerSegment, {from: broadcaster})

            const segmentRange0 = [0, 3]
            const dummyClaimRoot = "0x1000000000000000000000000000000000000000000000000000000000000000"
            // Transcoder submits claim 0
            await jobsManager.claimWork(jobId, segmentRange0, dummyClaimRoot, {from: electedTranscoder})
            const segmentRange1 = [4, 7]
            // Transcoder submits claim 1
            await jobsManager.claimWork(jobId, segmentRange1, dummyClaimRoot, {from: electedTranscoder})
            const segmentRange2 = [8, 11]
            // Transcoder submits claim 2
            await jobsManager.claimWork(jobId, segmentRange2, dummyClaimRoot, {from: electedTranscoder})

            // Fast foward through verification period and slashing period
            const verificationPeriod = await jobsManager.verificationPeriod.call()
            const slashingPeriod = await jobsManager.slashingPeriod.call()
            await rpc.wait(20, verificationPeriod.plus(slashingPeriod).toNumber())
        })

        it("should update job escrow for multiple claims", async () => {
            await jobsManager.batchDistributeFees(jobId, claimIds, {from: electedTranscoder})

            const job = await jobsManager.jobs.call(jobId)
            assert.equal(job[7], 30, "escrow is incorrect")
        })

        it("should set all claims as complete", async () => {
            const claim0 = await jobsManager.getClaimDetails(jobId, 0)
            assert.equal(claim0[6], 2, "claim 0 status is incorrect")

            const claim1 = await jobsManager.getClaimDetails(jobId, 1)
            assert.equal(claim1[6], 2, "claim 1 status is incorrect")
        })
    })

    describe("missedVerificationSlash", () => {
        const broadcaster = accounts[0]
        const electedTranscoder = accounts[1]

        const createJob = async (streamId, dummyTranscodingOptions, maxPricePerSegment) => {
            // Broadcaster deposits fees
            await token.approve(jobsManager.address, 1000, {from: broadcaster})
            await jobsManager.deposit(1000, {from: broadcaster})

            // Broadcaster creates job
            await jobsManager.job(streamId, dummyTranscodingOptions, maxPricePerSegment, {from: broadcaster})
        }

        const createDummyClaim = async jobId => {
            const segmentRange = [0, 3]
            const dummyClaimRoot = "0x1000000000000000000000000000000000000000000000000000000000000000"
            // Transcoder submits claim 0 (failingChecksClaimId)
            await jobsManager.claimWork(jobId, segmentRange, dummyClaimRoot, {from: electedTranscoder})
        }

        const createVerifiedClaim = async (jobId, claimId, streamId) => {
            // Segment data hashes
            const d0 = "0x80084bf2fba02475726feb2cab2d8215eab14bc6bdd8bfb2c8151257032ecd8b"
            const d1 = "0xb039179a8a4ce2c252aa6f2f25798251c19b75fc1508d9d511a191e0487d64a7"
            const d2 = "0x263ab762270d3b73d3e2cddf9acc893bb6bd41110347e5d5e4bd1d3c128ea90a"
            const d3 = "0x4ce8765e720c576f6f5a34ca380b3de5f0912e6e3cc5355542c363891e54594b"

            // Segment hashes (streamId, segmentSequenceNumber, dataHash)
            const s0 = ethAbi.soliditySHA3(["string", "uint256", "string"], [streamId, 0, d0])
            const s1 = ethAbi.soliditySHA3(["string", "uint256", "string"], [streamId, 1, d1])
            const s2 = ethAbi.soliditySHA3(["string", "uint256", "string"], [streamId, 2, d2])
            const s3 = ethAbi.soliditySHA3(["string", "uint256", "string"], [streamId, 3, d3])

            // Transcoded data hashes
            const tD0 = "0x42538602949f370aa331d2c07a1ee7ff26caac9cc676288f94b82eb2188b8465"
            const tD1 = "0xa0b37b8bfae8e71330bd8e278e4a45ca916d00475dd8b85e9352533454c9fec8"
            const tD2 = "0x9f2898da52dedaca29f05bcac0c8e43e4b9f7cb5707c14cc3f35a567232cec7c"
            const tD3 = "0x5a082c81a7e4d5833ee20bd67d2f4d736f679da33e4bebd3838217cb27bec1d3"

            // Broadcaster signatures over segments
            const bSig0 = ethUtil.toBuffer(web3.eth.sign(broadcaster, ethUtil.bufferToHex(s0)))
            const bSig1 = ethUtil.toBuffer(web3.eth.sign(broadcaster, ethUtil.bufferToHex(s1)))
            const bSig2 = ethUtil.toBuffer(web3.eth.sign(broadcaster, ethUtil.bufferToHex(s2)))
            const bSig3 = ethUtil.toBuffer(web3.eth.sign(broadcaster, ethUtil.bufferToHex(s3)))

            // Transcode receipts
            const tReceipt0 = ethAbi.soliditySHA3(["string", "uint256", "string", "string", "bytes"], [streamId, 0, d0, tD0, bSig0])
            const tReceipt1 = ethAbi.soliditySHA3(["string", "uint256", "string", "string", "bytes"], [streamId, 1, d1, tD1, bSig1])
            const tReceipt2 = ethAbi.soliditySHA3(["string", "uint256", "string", "string", "bytes"], [streamId, 2, d2, tD2, bSig2])
            const tReceipt3 = ethAbi.soliditySHA3(["string", "uint256", "string", "string", "bytes"], [streamId, 3, d3, tD3, bSig3])

            // Build merkle tree
            const merkleTree = new MerkleTree([tReceipt0, tReceipt1, tReceipt2, tReceipt3])

            const segmentRange = [0, 3]
            const segmentNumber = 0
            // Transcoder submits claim
            await jobsManager.claimWork(jobId, segmentRange, merkleTree.getHexRoot(), {from: electedTranscoder})
            // Transcoder calls verify
            await jobsManager.verify(jobId, claimId, segmentNumber, d0, tD0, ethUtil.bufferToHex(bSig0), merkleTree.getHexProof(tReceipt0), {from: electedTranscoder})
        }

        describe("failing checks", () => {
            const jobId = 0
            const claimId = 0
            const segmentNumber = 0

            before(async () => {
                await setup()

                const streamId = "1"
                const dummyTranscodingOptions = "0x123"
                const maxPricePerSegment = 10
                await createJob(streamId, dummyTranscodingOptions, maxPricePerSegment)

                await createDummyClaim(jobId)
            })

            it("should throw if verification period is not over", async () => {
                await expectThrow(jobsManager.missedVerificationSlash(jobId, claimId, segmentNumber, {from: accounts[2]}))
            })

            it("should throw if segment is not eligible for verification", async () => {
                // Fast foward through verification period
                const verificationPeriod = await jobsManager.verificationPeriod.call()
                await rpc.wait(20, verificationPeriod.toNumber())

                const invalidSegmentNumber = 99
                await expectThrow(jobsManager.missedVerificationSlash(jobId, claimId, invalidSegmentNumber, {from: accounts[2]}))
            })

            it("should throw if slashing period is over", async () => {
                // Fast forward through slashing period
                const slashingPeriod = await jobsManager.slashingPeriod.call()
                await rpc.wait(20, slashingPeriod.toNumber())

                await expectThrow(jobsManager.missedVerificationSlash(jobId, claimId, segmentNumber, {from: accounts[2]}))
            })
        })

        describe("verified segment", () => {
            const jobId = 0
            const claimId = 0
            const segmentNumber = 0

            before(async () => {
                await setup()

                const streamId = "1"
                const dummyTranscodingOptions = "0x123"
                const maxPricePerSegment = 10
                await createJob(streamId, dummyTranscodingOptions, maxPricePerSegment)

                await createVerifiedClaim(jobId, claimId, streamId)

                // Fast forward through verification period
                const verificationPeriod = await jobsManager.verificationPeriod.call()
                await rpc.wait(20, verificationPeriod.toNumber())
            })

            it("should throw if segment was verified", async () => {
                await expectThrow(jobsManager.missedVerificationSlash(jobId, claimId, segmentNumber, {from: accounts[2]}))
            })
        })

        describe("successful slash", () => {
            const jobId = 0
            const claimId = 0
            const segmentNumber = 0

            before(async () => {
                await setup()

                const streamId = "1"
                const dummyTranscodingOptions = "0x123"
                const maxPricePerSegment = 10
                await createJob(streamId, dummyTranscodingOptions, maxPricePerSegment)

                await createDummyClaim(jobId)

                // Fast forward through verification period
                const verificationPeriod = await jobsManager.verificationPeriod.call()
                await rpc.wait(20, verificationPeriod.toNumber())
            })

            it("should update job escrow", async () => {
                await jobsManager.missedVerificationSlash(jobId, claimId, segmentNumber, {from: accounts[2]})

                const job = await jobsManager.jobs.call(jobId)
                assert.equal(job[7], 0, "escrow is incorrect")
            })

            it("should refund broadcaster deposit", async () => {
                assert.equal(await jobsManager.broadcasterDeposits.call(broadcaster), 1000, "broadcaster deposit is incorrect")
            })

            it("should set claim as slashed", async () => {
                const claim = await jobsManager.getClaimDetails(jobId, claimId)
                assert.equal(claim[6], 1, "claim status is incorrect")
            })

            it("should throw if claim is not pending", async () => {
                // Should fail because claim is already slashed
                await expectThrow(jobsManager.missedVerificationSlash(jobId, claimId, segmentNumber, {from: accounts[2]}))
            })
        })
    })
})
