import {assert} from "chai"
import {ethers, web3} from "hardhat"
const BigNumber = ethers.BigNumber
import chai from "chai"
import {solidity} from "ethereum-waffle"

import Fixture from "./helpers/Fixture"
import math from "../helpers/math"
import {ProposalState, VoteType} from "../helpers/governorEnums"

chai.use(solidity)
const {expect} = chai

describe("GovernorCountingOverridable", () => {
    let signers
    let fixture

    let votes
    let governor

    let proposer
    let proposalId
    let voters

    const initVoter = async ({
        signer,
        amount = ethers.utils.parseEther("1"),
        delegateAddress = signer.address
    }) => {
        await votes.mint(signer.address, amount)
        await votes.connect(signer).delegate(delegateAddress)
        return signer
    }

    const createProposal = async (proposer, description) => {
        const tx = await governor
            .connect(proposer)
            .propose([proposer.address], [100], ["0x"], description)

        const filter = governor.filters.ProposalCreated()
        const events = await governor.queryFilter(
            filter,
            tx.blockNumber,
            tx.blockNumber
        )
        const proposalId = events[0].args[0]
        return proposalId
    }

    before(async () => {
        signers = await ethers.getSigners()
        proposer = signers[0]
        voters = signers.slice(1, 11)

        fixture = new Fixture(web3)
        await fixture.deploy()

        // setup votes token

        const votesFac = await ethers.getContractFactory("VotesMock")
        votes = await votesFac.deploy()
        await votes.initialize()

        await initVoter({signer: proposer})
        for (const i = 1; i <= voters.length; i++) {
            await initVoter({
                signer: voters[i - 1],
                amount: ethers.utils.parseEther("1").mul(i)
            })
        }

        // setup governor

        const governorFac = await ethers.getContractFactory(
            "GovernorCountingOverridableHarness"
        )
        governor = await governorFac.deploy()
        await governor.initialize(votes.address)

        await signers[99].sendTransaction({
            to: governor.address,
            value: ethers.utils.parseEther("100")
        })

        proposalId = await createProposal(proposer, "Steal all the money")

        // skip a block so voting can start
        await fixture.rpc.wait()
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("test fixture", () => {
        const QUOTA = BigNumber.from(420000) // 42%
        const QUORUM = BigNumber.from(370000) // 37%
        const TOTAL_SUPPLY = ethers.utils.parseEther("56") // 1 (proposer) + (1 + 2 ... 9 + 10) (voters)

        let proposalSnapshot

        beforeEach(async () => {
            proposalSnapshot = await governor.proposalSnapshot(proposalId)
        })

        it("quota should be 42%", async () => {
            const quota = await governor.quota()
            assert.equal(quota.toString(), QUOTA.toString())
        })

        it("total supply should be 56 VTCK", async () => {
            const totalSupply = await votes.getPastTotalSupply(proposalSnapshot)
            assert.equal(totalSupply.toString(), TOTAL_SUPPLY.toString())
        })

        it("quorum should be 37% of total supply", async () => {
            const expectedQuorum = math.percOf(TOTAL_SUPPLY, QUORUM)

            const quorum = await governor.quorum(proposalSnapshot)
            assert.equal(quorum.toString(), expectedQuorum.toString())
        })

        it("it should use the block number as clock", async () => {
            assert.equal(
                await governor.clock(),
                await ethers.provider.getBlockNumber()
            )
        })
    })

    describe("COUNTING_MODE", () => {
        it("should include bravo support and all vote types on quorum count", async () => {
            assert.equal(
                await governor.COUNTING_MODE(),
                "support=bravo&quorum=for,abstain,against"
            )
        })
    })

    describe("hasVoted", () => {
        it("should return false for users that haven't voted", async () => {
            for (let i = 0; i < 10; i++) {
                assert.isFalse(
                    await governor.hasVoted(proposalId, signers[i].address)
                )
            }
        })

        it("should return true after voting", async () => {
            await governor.connect(voters[0]).castVote(proposalId, VoteType.For)

            assert.isTrue(
                await governor.hasVoted(proposalId, voters[0].address)
            )
        })
    })

    describe("proposalVotes", () => {
        it("should return the sum of all votes made of each type", async () => {
            // against, for abstain, as per bravo ordering
            const tally = [0, 0, 0]

            const checkTally = async () => {
                const ether = ethers.utils.parseEther("1")
                const expected = tally.map(c => ether.mul(c).toString())

                const votes = await governor
                    .proposalVotes(proposalId)
                    .then(v => v.map(v => v.toString()))

                assert.deepEqual(votes, expected)
            }

            for (let i = 1; i <= 10; i++) {
                await checkTally()

                // Each voter has a voting power of {i} VTCK
                const voteType =
                    i % 2 ?
                        VoteType.Against : // 25 Against (1 + 3 + 5 + 7 + 9)
                        i % 3 ?
                            VoteType.For : // 24 For (2 + 4 + 8 + 10)
                            VoteType.Abstain // 6 abstain (6)

                await governor
                    .connect(voters[i - 1])
                    .castVote(proposalId, voteType)
                tally[voteType] += i
            }

            // sanity check
            assert.deepEqual(tally, [25, 24, 6])
            await checkTally()

            await fixture.rpc.wait(100)

            assert.equal(
                await governor.state(proposalId),
                ProposalState.Succeeded // funds were stolen!
            )
        })
    })

    describe("_quorumReached", () => {
        it("should return false if less than the quorum has voted", async () => {
            // results in a 35.7% participation, just below the quorum of 37%
            const voterIdxs = [1, 2, 3, 4, 10]

            assert.isFalse(await governor.quorumReached(proposalId))
            for (const i of voterIdxs) {
                await governor
                    .connect(voters[i - 1])
                    .castVote(proposalId, i % 3) // should count all vote types

                assert.isFalse(await governor.quorumReached(proposalId))
            }
        })

        it("should return true after quorum has voted", async () => {
            // results in a 37.5% participation, above quorum of 37%
            const voterIdxs = [1, 2, 3, 4, 5, 6]

            for (const i of voterIdxs) {
                await governor
                    .connect(voters[i - 1])
                    .castVote(proposalId, i % 3) // should count all vote types
            }
            assert.isTrue(await governor.quorumReached(proposalId))
        })
    })

    describe("_voteSucceeded", () => {
        it("should return false when less than the quota voted For", async () => {
            // results in a 41.8% For votes, just below the quota of 42%
            const forVotersIdxs = [1, 2, 3, 4, 5, 8]

            // starts as true as 0>=0, governor never uses it without checking quorum
            assert.isTrue(await governor.voteSucceeded(proposalId))

            const [forVotes, totalVotes] = [0, 0]
            for (let i = 1; i <= 10; i++) {
                const voteType = forVotersIdxs.includes(i) ?
                    VoteType.For :
                    VoteType.Against

                await governor
                    .connect(voters[i - 1])
                    .castVote(proposalId, voteType)

                totalVotes += i
                if (voteType === VoteType.For) {
                    forVotes += i
                }

                assert.equal(
                    await governor.voteSucceeded(proposalId),
                    forVotes > Math.floor(0.42 * totalVotes)
                )
            }

            // double check the expected end result
            assert.isFalse(await governor.voteSucceeded(proposalId))

            await fixture.rpc.wait(100)

            assert.equal(
                await governor.state(proposalId), // calls _voteSucceeded internally
                ProposalState.Defeated // not enough for votes
            )
        })

        it("should return true if For votes are higher than quota", async () => {
            // results in 43.6% For votes, above the quota of 42%
            const forVotersIdxs = [1, 2, 3, 4, 5, 9]

            for (let i = 1; i <= 10; i++) {
                const voteType = forVotersIdxs.includes(i) ?
                    VoteType.For :
                    VoteType.Against

                await governor
                    .connect(voters[i - 1])
                    .castVote(proposalId, voteType)
            }

            assert.isTrue(await governor.voteSucceeded(proposalId))

            await fixture.rpc.wait(100)

            assert.equal(
                await governor.state(proposalId), // calls _voteSucceeded internally
                ProposalState.Succeeded // money stolen :(
            )
        })

        it("should ignore abstain votes", async () => {
            const multiVote = async (idxs, support) => {
                for (const i of idxs) {
                    await governor
                        .connect(voters[i - 1])
                        .castVote(proposalId, support)
                }
            }

            await multiVote([1, 2, 3], VoteType.For)
            await multiVote([4, 5], VoteType.Against)
            // 40% For votes at this point, if Against was counted as For it'd change
            assert.isFalse(await governor.voteSucceeded(proposalId))

            await multiVote([6], VoteType.Abstain)
            // does't make it true (not counted as For)
            assert.isFalse(await governor.voteSucceeded(proposalId))

            // now tip the scales
            await multiVote([7], VoteType.For)
            assert.isTrue(await governor.voteSucceeded(proposalId))

            await multiVote([8, 9, 10], VoteType.Abstain)
            // doesn't make it false either (not counted as Against)
            assert.isTrue(await governor.voteSucceeded(proposalId))
        })
    })

    describe("_countVote", () => {
        let delegators
        let transcoders

        // override proposalId in these tests
        let proposalId

        beforeEach(async () => {
            // rename them here for simpler reasoning
            transcoders = voters
            delegators = signers.slice(11, 21)

            for (const i = 1; i <= delegators.length; i++) {
                await initVoter({
                    signer: delegators[i - 1],
                    amount: ethers.utils.parseEther("1").mul(i),
                    // with this the `transcoders` should have 2x their voting power
                    delegateAddress: transcoders[i - 1].address
                })
            }

            // create another proposal so it grabs the new snapshot
            proposalId = await createProposal(
                proposer,
                "Totally not steal all the money"
            )
            await fixture.rpc.wait()
        })

        const expectVotes = async expected => {
            expected = expected.map(e =>
                ethers.utils.parseEther("1").mul(e).toString()
            )

            const votes = await governor
                .proposalVotes(proposalId)
                .then(v => v.map(v => v.toString()))
            assert.deepEqual(votes, expected)
        }

        it("should fail on invalid vote type", async () => {
            await expect(
                governor.connect(transcoders[0]).castVote(proposalId, 7)
            ).to.be.revertedWith("InvalidVoteType(7)")
        })

        it("should fail on duplicate votes", async () => {
            await governor
                .connect(transcoders[0])
                .castVote(proposalId, VoteType.For)

            await expect(
                governor
                    .connect(transcoders[0])
                    .castVote(proposalId, VoteType.For)
            ).to.be.revertedWith("VoteAlreadyCast()")
        })

        describe("overrides", () => {
            for (const transVote of Object.keys(VoteType)) {
                describe(`transcoder votes ${transVote} first`, () => {
                    beforeEach(async () => {
                        await governor
                            .connect(transcoders[0])
                            .castVote(proposalId, VoteType[transVote])
                    })

                    it("should count transcoder votes with delegations", async () => {
                        const expected = [0, 0, 0]
                        expected[VoteType[transVote]] += 2

                        await expectVotes(expected)
                    })

                    for (const delVote of Object.keys(VoteType)) {
                        describe(`delegator votes ${delVote} after`, () => {
                            beforeEach(async () => {
                                await governor
                                    .connect(delegators[0])
                                    .castVote(proposalId, VoteType[delVote])
                            })

                            it("should count delegator votes and deduct transcoder", async () => {
                                const expected = [0, 0, 0]
                                expected[VoteType[transVote]] += 1
                                expected[VoteType[delVote]] += 1

                                await expectVotes(expected)
                            })
                        })
                    }
                })
            }

            describe("delegator votes first", () => {
                beforeEach(async () => {
                    await governor
                        .connect(delegators[0])
                        .castVote(proposalId, VoteType.Against)
                })

                it("should count delegator votes", async () => {
                    await expectVotes([1, 0, 0])
                })

                describe("transcoder votes after", () => {
                    beforeEach(async () => {
                        await governor
                            .connect(transcoders[0])
                            .castVote(proposalId, VoteType.Abstain)
                    })

                    it("should count transcoder votes without delegation", async () => {
                        await expectVotes([1, 0, 1])
                    })
                })
            })
        })
    })
})
