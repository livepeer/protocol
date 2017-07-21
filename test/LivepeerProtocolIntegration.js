import RPC from "../utils/rpc"
import expectThrow from "./helpers/expectThrow"
import MerkleTree from "../utils/merkleTree"
import abi from "ethereumjs-abi"
import utils from "ethereumjs-util"

var LivepeerProtocol = artifacts.require("LivepeerProtocol")
var LivepeerToken = artifacts.require("LivepeerToken")
var BondingManager = artifacts.require("BondingManager")
var RoundsManager = artifacts.require("RoundsManager")
var JobsManager = artifacts.require("JobsManager")

const ROUND_LENGTH = 50
const CYCLE_LENGTH = 25
const NUM_ACTIVE_TRANSCODERS = 1;

contract("LivepeerProtocolIntegration", accounts => {
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
        token.transfer(accounts[2], 500, {from: accounts[0]})
        token.transfer(accounts[3], 500, {from: accounts[0]})

        bondingManager = await BondingManager.new(token.address, NUM_ACTIVE_TRANSCODERS)
        // Set BondingManager as token owner
        token.transferOwnership(bondingManager.address, {from: accounts[0]})

        roundsManager = await RoundsManager.new()
        jobsManager = await JobsManager.new()

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

    describe("reward flow", () => {
        const stake1 = 100
        const stake2 = 100
        const stake3 = 100

        before(async () => {
            await setup()
        })

        it("transcoder should register and delegators should bond to it", async () => {
            const blockRewardCut = 10
            const feeShare = 5
            const pricePerSegment = 100

            // Account 0 => transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: accounts[0]})
            // Account 1 bonds to Account 0
            await token.approve(bondingManager.address, stake1, {from: accounts[1]})
            await bondingManager.bond(stake1, accounts[0], {from: accounts[1]})
            // Account 2 bonds to Account 0
            await token.approve(bondingManager.address, stake2, {from: accounts[2]})
            await bondingManager.bond(stake2, accounts[0], {from: accounts[2]})
            // Account 3 bonds to Account 0
            await token.approve(bondingManager.address, stake3, {from: accounts[3]})
            await bondingManager.bond(stake3, accounts[0], {from: accounts[3]})

            assert.equal(await bondingManager.transcoderTotalStake(accounts[0]), stake1 + stake2 + stake3, "transcoder total stake incorrect")
        })

        describe("reward call in first cycle of a round", () => {
            it("transcoder should be active at the start of a new round", async () => {
                // Fast foward to next round
                await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH)
                await roundsManager.initializeRound({from: accounts[0]})

                assert.isOk(await bondingManager.isActiveTranscoder.call(accounts[0]), "transcoder is not active")
            })

            it("transcoder should call reward during its time window", async () => {
                await bondingManager.reward({from: accounts[0]})
            })

            it("reward should update transcoder total stake with minted tokens", async () => {
                const mintedTokensPerReward = await bondingManager.mintedTokensPerReward()
                const initialTranscoderTotalStake = stake1 + stake2 + stake3
                const updatedTranscoderTotalStake = await bondingManager.transcoderTotalStake(accounts[0])

                assert.equal(updatedTranscoderTotalStake.minus(initialTranscoderTotalStake), mintedTokensPerReward.toNumber(), "transcoder total stake not updated with minted tokens correctly")
            })

            it("delegator should update own stake when unbonding", async () => {
                // Account 1 unbonds from Account 0
                await bondingManager.unbond({from: accounts[1]})

                const mintedTokensPerReward = await bondingManager.mintedTokensPerReward()
                const delegator = await bondingManager.delegators.call(accounts[1])
                const updatedDelegatorStake = delegator[1]
                const transcoderTotalStake = stake1 + stake2 + stake3

                // BlockRewardCut = 10%
                const delegatorRewardShare = mintedTokensPerReward.times(stake1).dividedBy(transcoderTotalStake).times(.9).floor().toNumber()
                assert.equal(updatedDelegatorStake.minus(stake1), delegatorRewardShare, "delegator stake not updated correctly")
            })
        })

        describe("reward call in next cycle of a round after a delegator unbonded", () => {
            let initialTranscoderTotalStake

            before(async () => {
                initialTranscoderTotalStake = await bondingManager.transcoderTotalStake(accounts[0])

                const blockRewardCut = 10
                const feeShare = 5
                const pricePerSegment = 100

                // Account 4 => transcoder
                await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: accounts[4]})
            })

            it("transcoder should call reward during its time window", async () => {
                // Fast foward to next cycle
                await rpc.waitUntilNextBlockMultiple(20, CYCLE_LENGTH)
                await bondingManager.reward({from: accounts[0]})
            })

            it("reward should update transcoder total stake with minted tokens for reward in another cycle", async () => {
                const mintedTokensPerReward = await bondingManager.mintedTokensPerReward()
                const updatedTranscoderTotalStake = await bondingManager.transcoderTotalStake(accounts[0])

                assert.equal(updatedTranscoderTotalStake.minus(initialTranscoderTotalStake), mintedTokensPerReward.toNumber(), "transcoder total stake not updated with minted tokens")
            })

            it("delegator should update own stake when bonding to another transcoder", async () => {
                // Account 2 moves bond to Account 4
                await bondingManager.bond(0, accounts[4], {from: accounts[2]})

                const mintedTokensPerReward = await bondingManager.mintedTokensPerReward()
                const delegator = await bondingManager.delegators.call(accounts[2])
                const updatedDelegatorStake = delegator[1]
                const transcoderTotalStake = stake1 + stake2 + stake3

                // BlockRewardCut = 10%
                // Delegator earns reward shares from 2 reward calls
                const delegatorRewardShare = mintedTokensPerReward.times(stake1).dividedBy(transcoderTotalStake).times(.9).floor().times(2).toNumber()
                assert.equal(updatedDelegatorStake.minus(stake2), delegatorRewardShare, "delegator stake not updated correctly")
            })
        })
    })

    describe("job-claim-verify loop", () => {
        const stake1 = 100

        const streamId = "1"
        const dummyTranscodingOptions = "0x123"
        const maxPricePerSegment = 100

        before(async () => {
            await setup()
        })

        it("transcoder should register and delegators should bond to it", async () => {
            const blockRewardCut = 10
            const feeShare = 5
            const pricePerSegment = 100

            // Account 0 => transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: accounts[0]})
            // Account 1 bonds to Account 0
            await token.approve(bondingManager.address, stake1, {from: accounts[1]})
            await bondingManager.bond(stake1, accounts[0], {from: accounts[1]})
        })

        it("transcoder should be active at the start of a new round", async () => {
            // Fast foward to next round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH)
            await roundsManager.initializeRound({from: accounts[0]})

            assert.isOk(await bondingManager.isActiveTranscoder.call(accounts[0]), "transcoder is not active")
        })

        describe("broadcaster creates a job", () => {
            it("new job event should fire when new job is created", async () => {
                let e = jobsManager.NewJob({topics: [accounts[0]]})

                e.watch(async (err, result) => {
                    e.stopWatching()

                    assert.equal(result.args.jobId, 0, "new job id incorrect")
                })

                // Account 2 creates job
                await jobsManager.job(streamId, dummyTranscodingOptions, maxPricePerSegment, {from: accounts[2]})
            })

            it("transcoder can get stream id with job id", async () => {
                const jobId = 0

                assert.equal(await jobsManager.getJobStreamId(jobId), streamId, "stream id for job id incorrect")
            })
        })

        describe("transcoder claims work and invokes verify", () => {
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
                bSig0 = utils.toBuffer(await web3.eth.sign(accounts[2], utils.bufferToHex(s0)));
                bSig1 = utils.toBuffer(await web3.eth.sign(accounts[2], utils.bufferToHex(s1)));
                bSig2 = utils.toBuffer(await web3.eth.sign(accounts[2], utils.bufferToHex(s2)));
                bSig3 = utils.toBuffer(await web3.eth.sign(accounts[2], utils.bufferToHex(s3)));

                tClaim0 = abi.soliditySHA3(["string", "uint256", "bytes", "bytes", "bytes"], [streamId, 0, d0, tD0, bSig0]);
                tClaim1 = abi.soliditySHA3(["string", "uint256", "bytes", "bytes", "bytes"], [streamId, 1, d1, tD1, bSig1]);
                tClaim2 = abi.soliditySHA3(["string", "uint256", "bytes", "bytes", "bytes"], [streamId, 2, d2, tD2, bSig2]);
                tClaim3 = abi.soliditySHA3(["string", "uint256", "bytes", "bytes", "bytes"], [streamId, 3, d3, tD3, bSig3]);

                // Generate Merkle root
                const merkleTree = new MerkleTree([tClaim0, tClaim1, tClaim2, tClaim3])
                root = merkleTree.getHexRoot()
                proof = merkleTree.getHexProof(tClaim0)
            })

            describe("transcoder claims work", () => {
                it("transcoder can claim work for a range of segments", async () => {
                    // Account 0 claims work
                    await jobsManager.claimWork(0, 0, 3, root, {from: accounts[0]});
                })
            })

            describe("transcoder invokes verify", () => {
                it("transcoder can invoke verify and submit a merkle proof", async () => {
                    // Account 0 calls verify
                    await jobsManager.verify(0, 0, utils.bufferToHex(d0), utils.bufferToHex(tD0), utils.bufferToHex(bSig0), proof, {from: accounts[0]});
                })
            })
        })
    })
})
