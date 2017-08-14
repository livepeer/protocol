import RPC from "../utils/rpc"
import MerkleTree from "../utils/merkleTree"
import ethUtil from "ethereumjs-util"
import ethAbi from "ethereumjs-abi"
import BigNumber from "bignumber.js"

const LivepeerProtocol = artifacts.require("LivepeerProtocol")
const LivepeerToken = artifacts.require("LivepeerToken")
const BondingManager = artifacts.require("BondingManager")
const RoundsManager = artifacts.require("RoundsManager")
const JobsManager = artifacts.require("JobsManager")
const IdentityVerifier = artifacts.require("IdentityVerifier")

const ROUND_LENGTH = 50
const NUM_ACTIVE_TRANSCODERS = 1

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

        // Initial token distribution
        token = await LivepeerToken.new()
        token.mint(accounts[0], 3000000000000000000, {from: accounts[0]})
        token.transfer(accounts[1], 1000000, {from: accounts[0]})
        token.transfer(accounts[2], 1000000, {from: accounts[0]})
        token.transfer(accounts[3], 1000000, {from: accounts[0]})
        token.transfer(accounts[4], 1000000, {from: accounts[0]})
        token.transfer(accounts[5], 1000000, {from: accounts[0]})

        // Create verifier
        const verifier = await IdentityVerifier.new()

        // Create protocol
        const protocol = await LivepeerProtocol.new()

        // Create bonding manager
        bondingManager = await BondingManager.new(protocol.address, token.address, NUM_ACTIVE_TRANSCODERS)
        token.transferOwnership(bondingManager.address, {from: accounts[0]})

        // Create jobs manager
        jobsManager = await JobsManager.new(protocol.address, token.address, verifier.address)

        // // Create rounds manager
        roundsManager = await RoundsManager.new(protocol.address)

        // // Register managers
        await protocol.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["BondingManager"])), bondingManager.address)
        await protocol.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["JobsManager"])), jobsManager.address)
        await protocol.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["RoundsManager"])), roundsManager.address)

        await protocol.unpause()
    }

    describe("reward flow", () => {
        const transcoder0 = accounts[1]
        const transcoder1 = accounts[2]
        const delegator0 = accounts[3]
        const delegator1 = accounts[4]
        const delegator2 = accounts[5]

        const transcoderBond0 = 100
        const transcoderBond1 = 100
        const delegatorBond0 = 100
        const delegatorBond1 = 100
        const delegatorBond2 = 100

        before(async () => {
            await setup()
        })

        it("transcoder should register and delegators should bond to it", async () => {
            const blockRewardCut = 10
            const feeShare = 5
            const pricePerSegment = 10

            // Register as transcoder
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: transcoder0})
            // Transcoder bonds
            await token.approve(bondingManager.address, transcoderBond0, {from: transcoder0})
            await bondingManager.bond(transcoderBond0, transcoder0, {from: transcoder0})
            // Delegator 0 bonds to transcoder
            await token.approve(bondingManager.address, delegatorBond0, {from: delegator0})
            await bondingManager.bond(delegatorBond0, transcoder0, {from: delegator0})
            // // Delegator 1 bonds to transcoder
            await token.approve(bondingManager.address, delegatorBond1, {from: delegator1})
            await bondingManager.bond(delegatorBond1, transcoder0, {from: delegator1})
            // // Delegator 2 bonds to transcoder
            await token.approve(bondingManager.address, delegatorBond2, {from: delegator2})
            await bondingManager.bond(delegatorBond2, transcoder0, {from: delegator2})

            const transcoderTotalStake = transcoderBond0 + delegatorBond0 + delegatorBond1 + delegatorBond2
            assert.equal(await bondingManager.transcoderTotalStake(transcoder0), transcoderTotalStake, "transcoder0 total stake incorrect")
        })

        describe("reward call during a round", () => {
            it("transcoder should be active at the start of a new round", async () => {
                // Fast foward to next round
                await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH)
                await roundsManager.initializeRound({from: transcoder0})

                assert.isOk(await bondingManager.isActiveTranscoder.call(transcoder0), "transcoder is not active")
            })

            it("transcoder should call reward", async () => {
                await bondingManager.reward({from: transcoder0})
            })

            it("reward should update transcoder total stake with minted tokens", async () => {
                const mintedTokensPerReward = await bondingManager.mintedTokensPerReward()
                const initialTranscoderTotalStake = transcoderBond0 + delegatorBond0 + delegatorBond1 + delegatorBond2
                const updatedTranscoderTotalStake = await bondingManager.transcoderTotalStake(transcoder0)

                assert.equal(updatedTranscoderTotalStake.minus(initialTranscoderTotalStake), mintedTokensPerReward.toNumber(), "transcoder total stake not updated with minted tokens correctly")
            })

            it("delegator should update own stake when unbonding", async () => {
                // Account 1 unbonds from Account 0
                await bondingManager.unbond({from: delegator0})

                const mintedTokensPerReward = await bondingManager.mintedTokensPerReward()
                const delegator = await bondingManager.delegators.call(delegator0)
                const updatedDelegatorStake = delegator[1]
                const transcoderTotalStake = transcoderBond0 + delegatorBond0 + delegatorBond1 + delegatorBond2

                // BlockRewardCut = 10%
                const delegatorRewardShare = mintedTokensPerReward.times(delegatorBond0).dividedBy(transcoderTotalStake).times(.9).floor().toNumber()
                assert.equal(updatedDelegatorStake.minus(delegatorBond0), delegatorRewardShare, "delegator stake not updated correctly")
            })
        })

        describe("reward call during another round", () => {
            let initialTranscoderTotalStake

            before(async () => {
                initialTranscoderTotalStake = await bondingManager.transcoderTotalStake(transcoder0)

                const blockRewardCut = 10
                const feeShare = 5
                const pricePerSegment = 10

                await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: transcoder1})
            })

            it("transcoder should call reward", async () => {
                await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH)
                await roundsManager.initializeRound({from: transcoder0})
                await bondingManager.reward({from: transcoder0})
            })

            it("delegator should update own stake when bonding to another transcoder", async () => {
                await bondingManager.bond(0, transcoder1, {from: delegator1})

                const mintedTokensPerReward = await bondingManager.mintedTokensPerReward()
                const delegator = await bondingManager.delegators.call(delegator1)
                const updatedDelegatorStake = delegator[1]
                const transcoderTotalStake0 = transcoderBond0 + delegatorBond0 + delegatorBond1 + delegatorBond2
                const transcoderTotalStake1 = initialTranscoderTotalStake

                // BlockRewardCut = 10%
                // Delegator earns reward shares from 2 reward calls
                const delegatorRewardShare0 = mintedTokensPerReward.times(delegatorBond1).dividedBy(transcoderTotalStake0).times(.9).floor().toNumber()
                const delegatorRewardShare1 = mintedTokensPerReward.times(delegatorBond1).dividedBy(initialTranscoderTotalStake).times(.9).floor().toNumber()
                assert.equal(updatedDelegatorStake.minus(delegatorBond1), delegatorRewardShare0 + delegatorRewardShare1, "delegator stake not updated correctly")
            })
        })
    })

    describe("job-claim-verify loop", () => {
        const transcoder = accounts[1]
        const delegator = accounts[2]
        const broadcaster = accounts[3]

        const transcoderBond = 100
        const delegatorBond = 100
        let transcoderTotalStakeBeforeLastReward

        const blockRewardCut = 10
        const feeShare = 5
        const pricePerSegment = 1000

        const streamId = "1"
        const dummyTranscodingOptions = "0x123"
        const maxPricePerSegment = 1000

        const jobDeposit = 10000

        before(async () => {
            await setup()
        })

        it("transcoder should register and delegators should bond to it", async () => {
            await bondingManager.transcoder(blockRewardCut, feeShare, pricePerSegment, {from: transcoder})

            await token.approve(bondingManager.address, transcoderBond, {from: transcoder})
            await bondingManager.bond(transcoderBond, transcoder, {from: transcoder})

            await token.approve(bondingManager.address, delegatorBond, {from: delegator})
            await bondingManager.bond(delegatorBond, transcoder, {from: delegator})
        })

        it("transcoder should be active at the start of a new round", async () => {
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH)
            await roundsManager.initializeRound({from: transcoder})

            assert.isOk(await bondingManager.isActiveTranscoder.call(transcoder), "transcoder is not active")
        })

        describe("transcoder calls reward during the round", () => {
            it("transcoders should update own stake with rewards", async () => {
                transcoderTotalStakeBeforeLastReward = await bondingManager.transcoderTotalStake(transcoder)

                await bondingManager.reward({from: transcoder})

                const mintedTokens = await bondingManager.mintedTokensPerReward()
                const transcoderRewardShare = mintedTokens.times(blockRewardCut).div(100).floor()
                const registeredTranscoder = await bondingManager.transcoders.call(transcoder)
                assert.equal(registeredTranscoder[1], transcoderRewardShare.plus(transcoderBond).toNumber(), "transcoder bond is incorrect")
            })
        })

        describe("broadcaster creates a job", () => {
            it("broadcaster should update deposit", async () => {
                await token.approve(jobsManager.address, jobDeposit, {from: broadcaster})
                await jobsManager.deposit(jobDeposit, {from: broadcaster})

                assert.equal(await jobsManager.broadcasterDeposits.call(broadcaster), jobDeposit, "deposit is incorrect")
            })

            it("new job event should fire when new job is created", async () => {
                let e = jobsManager.NewJob({topics: [broadcaster]})

                e.watch(async (err, result) => {
                    e.stopWatching()

                    assert.equal(result.args.jobId, 0, "new job id incorrect")
                })

                await jobsManager.job(streamId, dummyTranscodingOptions, maxPricePerSegment, {from: broadcaster})
            })
        })

        describe("transcoder claims work and verifies", () => {
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

            // Transcode claims
            const tReceipt0 = ethAbi.soliditySHA3(["string", "uint256", "string", "string", "bytes"], [streamId, 0, d0, tD0, bSig0])
            const tReceipt1 = ethAbi.soliditySHA3(["string", "uint256", "string", "string", "bytes"], [streamId, 1, d1, tD1, bSig1])
            const tReceipt2 = ethAbi.soliditySHA3(["string", "uint256", "string", "string", "bytes"], [streamId, 2, d2, tD2, bSig2])
            const tReceipt3 = ethAbi.soliditySHA3(["string", "uint256", "string", "string", "bytes"], [streamId, 3, d3, tD3, bSig3])

            // Generate merkle tree
            const merkleTree = new MerkleTree([tReceipt0, tReceipt1, tReceipt2, tReceipt3])

            const jobId = 0
            const claimId = 0
            const segmentRange = [0, 3]
            const segmentNumber = 0

            describe("transcoder claims work", () => {
                it("transcoder can claim work for a range of segments", async () => {
                    await jobsManager.claimWork(jobId, segmentRange, merkleTree.getHexRoot(), {from: transcoder})
                })
            })

            describe("transcoder invokes verify", () => {
                it("transcoder can receive result of verification", async () => {
                    const e = jobsManager.ReceivedVerification({topics: [jobId, claimId]})

                    e.watch(async (err, result) => {
                        e.stopWatching()

                        assert.equal(result.args.result, true, "received verification result incorrect")
                    })

                    await jobsManager.verify(jobId, claimId, segmentNumber, d0, tD0, ethUtil.bufferToHex(bSig0), merkleTree.getHexProof(tReceipt0), {from: transcoder})
                })
            })
        })

        describe("transcoder distributes fees", () => {
            const jobId = 0
            const claimId = 0
            const fees = 4000

            before(async () => {
                const verificationPeriod = await jobsManager.verificationPeriod.call()
                const slashingPeriod = await jobsManager.slashingPeriod.call()

                await rpc.wait(20, verificationPeriod.plus(slashingPeriod).toNumber())
            })

            it("transcoder should update own stake with fees", async () => {
                let registeredTranscoder = await bondingManager.transcoders.call(transcoder)
                const initialTranscoderBond = registeredTranscoder[1]

                await jobsManager.distributeFees(jobId, claimId, {from: transcoder})

                const transcoderTotalStake = await bondingManager.transcoderTotalStake(transcoder)
                const delegatorsFeeShare = (new BigNumber(fees)).times(feeShare).div(100).floor()
                const transcoderFeeShare = (new BigNumber(fees)).minus(delegatorsFeeShare).plus(delegatorsFeeShare.times(initialTranscoderBond).div(transcoderTotalStake).floor())

                registeredTranscoder = await bondingManager.transcoders.call(transcoder)
                assert.equal(registeredTranscoder[1], initialTranscoderBond.plus(transcoderFeeShare).toNumber(), "transcoder bond is incorrect")
            })

            it("delegators should update own stake with rewards and fees when unbonding", async () => {
                let registeredDelegator = await bondingManager.delegators.call(delegator)
                const initialDelegatorBond = registeredDelegator[1]
                const transcoderTotalStake = await bondingManager.transcoderTotalStake(transcoder)
                const mintedTokens = await bondingManager.mintedTokensPerReward()

                await roundsManager.initializeRound({from: delegator})

                await bondingManager.unbond({from: delegator})
                const delegatorRewardShare = mintedTokens.times(100 - blockRewardCut).div(100).floor().times(initialDelegatorBond).div(transcoderTotalStakeBeforeLastReward).floor()
                const delegatorsFeeShare = (new BigNumber(fees)).times(feeShare).div(100).floor()
                const delegatorFeeShare = delegatorsFeeShare.times(initialDelegatorBond).div(transcoderTotalStake)

                registeredDelegator = await bondingManager.delegators.call(delegator)
                assert.equal(registeredDelegator[1], initialDelegatorBond.plus(delegatorRewardShare).plus(delegatorFeeShare).toNumber(), "delegator bond is incorrect")
            })
        })
    })
})
