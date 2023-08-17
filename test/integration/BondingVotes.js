import RPC from "../../utils/rpc"
import setupIntegrationTest from "../helpers/setupIntegrationTest"

import chai, {assert} from "chai"
import {ethers} from "hardhat"
import {solidity} from "ethereum-waffle"
import {BigNumber, constants} from "ethers"

import math from "../helpers/math"

chai.use(solidity)
const {expect} = chai

describe("BondingVotes", () => {
    let rpc

    let signers
    let bondingVotes
    let bondingManager
    let roundsManager
    let roundLength
    let token
    let minter

    const PERC_DIVISOR = 1000000
    const PERC_MULTIPLIER = PERC_DIVISOR / 100

    const lptAmount = amount => ethers.utils.parseEther("1").mul(amount)

    before(async () => {
        rpc = new RPC(web3)

        signers = await ethers.getSigners()
        const fixture = await setupIntegrationTest()

        bondingManager = await ethers.getContractAt(
            "BondingManager",
            fixture.BondingManager.address
        )

        bondingVotes = await ethers.getContractAt(
            "BondingVotes",
            fixture.BondingVotes.address
        )

        token = await ethers.getContractAt(
            "LivepeerToken",
            fixture.LivepeerToken.address
        )

        minter = await ethers.getContractAt("Minter", fixture.Minter.address)
        // simplify inflation calculations by making it fixed
        await minter.setInflationChange(0)
        mintableTokens = {}

        roundsManager = await ethers.getContractAt(
            "AdjustableRoundsManager",
            fixture.AdjustableRoundsManager.address
        )
        roundLength = (await roundsManager.roundLength()).toNumber()

        const controller = await ethers.getContractAt(
            "Controller",
            fixture.Controller.address
        )
        await controller.unpause()
    })

    // We re-define the before function for the sub-tests so it automatically
    // reverts any changes made on their set-up.
    const mochaBefore = before
    before = async setupFn => {
        let snapshotId

        mochaBefore(async () => {
            snapshotId = await rpc.snapshot()

            await setupFn()
        })

        after(async () => {
            await rpc.revert(snapshotId)
        })
    }

    let mintableTokens

    const nextRound = async (rounds = 1) => {
        await roundsManager.mineBlocks(rounds * roundLength)
        await roundsManager.initializeRound()
        const currRound = (await roundsManager.currentRound()).toNumber()
        mintableTokens[currRound] = await minter.currentMintableTokens()
        return currRound
    }

    const bond = async (delegator, amount, transcoder) => {
        await token.transfer(delegator.address, amount)
        await token.connect(delegator).approve(bondingManager.address, amount)
        await bondingManager.connect(delegator).bond(amount, transcoder.address)
    }

    describe("single active transcoder", () => {
        let transcoder
        let delegator
        let currentRound

        before(async () => {
            transcoder = signers[0]
            delegator = signers[1]

            // Initialize the first round ever
            await nextRound()

            for (const account of [transcoder, delegator]) {
                await bondingManager.checkpointBondingState(account.address)
            }

            // Round R-2
            await nextRound()

            await bond(transcoder, lptAmount(1), transcoder)
            await bondingManager
                .connect(transcoder)
                .transcoder(50 * PERC_MULTIPLIER, 25 * PERC_MULTIPLIER)

            // Round R-1
            await nextRound()

            await bond(delegator, lptAmount(1), transcoder)

            // Round R
            currentRound = await nextRound()

            await bondingManager.connect(transcoder).reward()

            // Round R+1
            await nextRound()

            await bondingManager.connect(transcoder).reward()

            // Round R+2
            await nextRound()
        })

        describe("getBondingStateAt", () => {
            it("should return partial rewards for any rounds since bonding", async () => {
                const pendingRewards0 = math.precise.percOf(
                    mintableTokens[currentRound].div(2), // 50% cut rate
                    lptAmount(1), // delegator stake
                    lptAmount(2) // transcoder stake
                )
                const pendingRewards1 = math.precise.percOf(
                    mintableTokens[currentRound + 1].div(2),
                    lptAmount(1).add(pendingRewards0),
                    lptAmount(2).add(mintableTokens[1])
                )

                const stakeAt = round =>
                    bondingVotes
                        .getBondingStateAt(delegator.address, round)
                        .then(n => n[0].toString())

                assert.equal(await stakeAt(2), 0)
                assert.equal(await stakeAt(currentRound - 1), 0)

                let stake = lptAmount(1) // bonded on previous round
                assert.equal(await stakeAt(currentRound), stake.toString())

                stake = stake.add(pendingRewards0) // reward call
                assert.equal(await stakeAt(currentRound + 1), stake.toString())

                stake = stake.add(pendingRewards1) // reward call
                assert.equal(await stakeAt(currentRound + 2), stake.toString())
            })

            it("should return partial rewards for all transcoder stake", async () => {
                const stakeAt = round =>
                    bondingVotes
                        .getBondingStateAt(transcoder.address, round)
                        .then(n => n[0].toString())

                assert.equal(await stakeAt(2), 0)
                assert.equal(await stakeAt(currentRound - 2), 0)

                let stake = lptAmount(1) // transcoder bonded on previous round
                assert.equal(await stakeAt(currentRound - 1), stake)

                stake = stake.add(lptAmount(1)) // delegator bonded on previous round
                assert.equal(await stakeAt(currentRound), stake)

                stake = lptAmount(2).add(mintableTokens[currentRound]) // reward call
                assert.equal(await stakeAt(currentRound + 1), stake)

                stake = stake.add(mintableTokens[currentRound + 1]) // reward call
                assert.equal(await stakeAt(currentRound + 2), stake)
            })
        })

        describe("getTotalActiveStakeAt", () => {
            const totalStakeAt = round =>
                bondingVotes
                    .getTotalActiveStakeAt(round)
                    .then(n => n.toString())

            it("should return total stake at any point in time", async () => {
                assert.equal(await totalStakeAt(2), 0)
                assert.equal(await totalStakeAt(currentRound - 2), 0)

                let stake = lptAmount(1) // transcoder bonded on previous round
                assert.equal(await totalStakeAt(currentRound - 1), stake)

                stake = stake.add(lptAmount(1)) // delegator bonded on previous round
                assert.equal(await totalStakeAt(currentRound), stake)

                stake = lptAmount(2).add(mintableTokens[currentRound]) // reward call
                assert.equal(await totalStakeAt(currentRound + 1), stake)

                stake = stake.add(mintableTokens[currentRound + 1]) // reward call
                assert.equal(await totalStakeAt(currentRound + 2), stake)
            })
        })
    })

    describe("inactive transcoders with stake", () => {
        let transcoders = []
        let activeTranscoders = []
        let delegators = []
        let currentRound

        const pendingStakesByRound = {}
        const totalActiveStakeByRound = {}

        const nextRoundAndSnapshot = async () => {
            const round = await nextRound()

            pendingStakesByRound[round] = {}
            for (const account of transcoders) {
                pendingStakesByRound[round][account.address] = (
                    await bondingManager.transcoderTotalStake(account.address)
                ).toString()
            }
            for (const account of delegators) {
                pendingStakesByRound[round][account.address] = (
                    await bondingManager.pendingStake(account.address, 0)
                ).toString()
            }

            totalActiveStakeByRound[round] = (
                await bondingManager.getTotalBonded()
            ).toString()

            return round
        }

        before(async () => {
            // migrations.config.ts defines default net numActiveTranscoders as 10
            activeTranscoders = signers.slice(0, 10)
            transcoders = signers.slice(0, 11)
            delegators = signers.slice(12, 23)

            // Initialize the first round ever
            await nextRound()

            for (const account of [...transcoders, ...delegators]) {
                await bondingManager.checkpointBondingState(account.address)
            }

            // Round R-2
            await nextRoundAndSnapshot()

            // make every transcoder with the same self-delegated stake
            for (const transcoder of transcoders) {
                await bond(transcoder, lptAmount(10), transcoder)
                await bondingManager
                    .connect(transcoder)
                    .transcoder(50 * PERC_MULTIPLIER, 25 * PERC_MULTIPLIER)
            }

            // Round R-1
            await nextRoundAndSnapshot()

            for (const i = 0; i < delegators.length; i++) {
                // Distribute stake regressively so the last T is always inactive
                const amount = lptAmount(11 - i)
                await bond(delegators[i], amount, transcoders[i])
            }

            // Round R
            currentRound = await nextRoundAndSnapshot()

            for (const transcoder of activeTranscoders) {
                await bondingManager.connect(transcoder).reward()
            }

            // Round R+1
            await nextRoundAndSnapshot()

            for (const transcoder of activeTranscoders) {
                await bondingManager.connect(transcoder).reward()
            }

            // Round R+2
            await nextRoundAndSnapshot()
        })

        it("active transcoder count should match BondingManager config", async () => {
            const maxSize = await bondingManager.getTranscoderPoolMaxSize()
            assert.equal(maxSize.toString(), activeTranscoders.length)
        })

        it("should have all active transcoders but the last one", async () => {
            const isActive = a => bondingManager.isActiveTranscoder(a)
            for (const transcoder of activeTranscoders) {
                assert.isTrue(await isActive(transcoder.address))
            }

            const inactiveTranscoder = transcoders[transcoders.length - 1]
            assert.isFalse(await isActive(inactiveTranscoder.address))
        })

        describe("getBondingStateAt", () => {
            it("should provide voting power even for inactive transcoders and their delegators", async () => {
                const transcoder = transcoders[transcoders.length - 1].address
                const delegator = delegators[delegators.length - 1].address

                const testHasStake = async (address, round) => {
                    const [stake] = await bondingVotes.getBondingStateAt(
                        address,
                        round
                    )
                    assert.isAbove(
                        stake,
                        0,
                        `expected non-zero stake checkpoint at round ${round} for account ${address}`
                    )
                }

                // transcoders self-bond at R-2 so start from the next round
                for (const r = currentRound - 1; r < currentRound + 2; r++) {
                    await testHasStake(transcoder, r)

                    // delegators only bond at R-1
                    if (r >= currentRound) {
                        await testHasStake(delegator, r)
                    }
                }
            })

            it("should return exactly the account pendingStake in the corresponding round", async () => {
                for (const round of Object.keys(pendingStakesByRound)) {
                    const pendingStakes = pendingStakesByRound[round]

                    for (const address of Object.keys(pendingStakes)) {
                        const expectedStake = pendingStakes[address]

                        const [stakeCheckpoint] =
                            await bondingVotes.getBondingStateAt(address, round)
                        assert.equal(
                            stakeCheckpoint.toString(),
                            expectedStake,
                            `stake mismatch at round ${round} for account ${address}`
                        )
                    }
                }
            })
        })

        describe("getTotalActiveStakeAt", () => {
            it("should return total supply from only the active stake at any point in time", async () => {
                for (const round of Object.keys(totalActiveStakeByRound)) {
                    const totalStakeCheckpoint =
                        await bondingVotes.getTotalActiveStakeAt(round)
                    assert.equal(
                        totalStakeCheckpoint.toString(),
                        totalActiveStakeByRound[round],
                        `total supply mismatch at round ${round}`
                    )
                }
            })

            it("should actually match the sum of all active transcoders stake", async () => {
                for (const r = currentRound - 2; r <= currentRound + 2; r++) {
                    const activeStakeSum = BigNumber.from(0)
                    for (const transcoder of activeTranscoders) {
                        const [stake] = await bondingVotes.getBondingStateAt(
                            transcoder.address,
                            r
                        )
                        activeStakeSum = activeStakeSum.add(stake)
                    }

                    const totalStake = await bondingVotes.getTotalActiveStakeAt(
                        r
                    )
                    assert.equal(
                        totalStake.toString(),
                        activeStakeSum.toString(),
                        `total supply mismatch at round ${r}`
                    )
                }
            })
        })
    })

    describe("intermittent reward-calling transcoder", () => {
        let transcoder
        let delegatorEarly
        let delegator
        let currentRound

        before(async () => {
            transcoder = signers[0]
            delegator = signers[1]
            delegatorEarly = signers[2]

            // Initialize the first round ever
            await nextRound()

            for (const account of [transcoder, delegator, delegatorEarly]) {
                await bondingManager.checkpointBondingState(account.address)
            }

            // Round R-202
            await nextRound()

            await bond(transcoder, lptAmount(1), transcoder)
            await bondingManager
                .connect(transcoder)
                .transcoder(50 * PERC_MULTIPLIER, 25 * PERC_MULTIPLIER)

            await bond(delegatorEarly, lptAmount(1), transcoder)

            // Round R-201
            await nextRound()

            await bondingManager.connect(transcoder).reward()

            // Round R-200
            await nextRound()

            await bond(delegator, lptAmount(1), transcoder)

            // Now hibernate for 200 rounds...
            for (const i = 0; i < 200; i++) {
                // Round R-200 until R that gets set to currentRound
                currentRound = await nextRound()
            }

            // Round R+1
            await nextRound()

            await bondingManager.connect(transcoder).reward()

            // Round R+2
            await nextRound()

            // Round R+3
            await nextRound()
        })

        describe("getBondingStateAt", () => {
            const stakeAt = (account, round) =>
                bondingVotes
                    .getBondingStateAt(account.address, round)
                    .then(n => n[0].toString())
            const expectStakeAt = async (account, round, expected) => {
                assert.equal(
                    await stakeAt(account, round),
                    expected.toString(),
                    `stake mismatch at round ${round}`
                )
            }

            it("consistent stake for delegator that had never observed a reward on the call gap", async () => {
                await expectStakeAt(delegator, currentRound - 200, 0) // bond made on this round

                let stake = lptAmount(1)
                await expectStakeAt(delegator, currentRound - 199, stake) // transcoder is gone from here until currRound+1
                await expectStakeAt(delegator, currentRound - 99, stake)
                await expectStakeAt(delegator, currentRound, stake)
                await expectStakeAt(delegator, currentRound + 1, stake) // reward is called again here

                const transcoderStake = lptAmount(3).add(
                    mintableTokens[currentRound - 201]
                )
                const pendingRewards0 = math.precise.percOf(
                    mintableTokens[currentRound + 1].div(2), // 50% cut rate
                    stake,
                    transcoderStake
                )
                stake = stake.add(pendingRewards0)
                await expectStakeAt(delegator, currentRound + 2, stake)
                await expectStakeAt(delegator, currentRound + 3, stake)
            })

            it("consistent stake for delegator that had unclaimed rewards", async () => {
                await expectStakeAt(delegatorEarly, currentRound - 202, 0) // bond is made here

                let stake = lptAmount(1)
                await expectStakeAt(delegatorEarly, currentRound - 201, stake) // reward is called first time

                const pendingRewards0 = math.precise.percOf(
                    mintableTokens[currentRound - 201].div(2), // 50% cut rate
                    lptAmount(1), // delegator stake
                    lptAmount(2) // transcoder stake
                )
                stake = stake.add(pendingRewards0)
                await expectStakeAt(delegatorEarly, currentRound - 200, stake) // transcoder is gone from here until currRound+1
                await expectStakeAt(delegatorEarly, currentRound - 199, stake)
                await expectStakeAt(delegatorEarly, currentRound - 99, stake)
                await expectStakeAt(delegatorEarly, currentRound, stake)
                await expectStakeAt(delegatorEarly, currentRound + 1, stake) // reward called again

                const pendingRewards1 = math.precise.percOf(
                    mintableTokens[currentRound + 1].div(2), // 50% cut rate
                    stake,
                    lptAmount(3).add(mintableTokens[currentRound - 201]) // transcoder stake (another delegator added 1 LPT)
                )
                stake = stake.add(pendingRewards1)
                await expectStakeAt(delegatorEarly, currentRound + 2, stake)
                await expectStakeAt(delegatorEarly, currentRound + 3, stake)
            })

            it("for the intermittent transcoder itself", async () => {
                await expectStakeAt(transcoder, currentRound - 202, 0) // both transcoder and delegator bond 1000

                let stake = lptAmount(2)
                await expectStakeAt(transcoder, currentRound - 201, stake) // reward is called first time

                stake = stake.add(mintableTokens[currentRound - 201])
                await expectStakeAt(transcoder, currentRound - 200, stake) // late delegator bonds 1 LPT more

                stake = stake.add(lptAmount(1))
                await expectStakeAt(transcoder, currentRound - 199, stake)
                await expectStakeAt(transcoder, currentRound - 99, stake)
                await expectStakeAt(transcoder, currentRound, stake)
                await expectStakeAt(transcoder, currentRound + 1, stake) // reward called again

                stake = stake.add(mintableTokens[currentRound + 1])
                await expectStakeAt(transcoder, currentRound + 2, stake)
                await expectStakeAt(transcoder, currentRound + 3, stake)
            })
        })

        describe("getTotalActiveStakeAt", () => {
            const totalStakeAt = round =>
                bondingVotes
                    .getTotalActiveStakeAt(round)
                    .then(n => n.toString())
            const expectTotalStakeAt = async (round, expected) => {
                assert.equal(
                    await totalStakeAt(round),
                    expected.toString(),
                    `total stake mismatch at round ${round}`
                )
            }

            it("maintains all history", async () => {
                await expectTotalStakeAt(currentRound - 202, 0) // both transcoder and delegator bond 1000

                let total = lptAmount(2)
                await expectTotalStakeAt(currentRound - 201, total) // reward is called first time

                total = total.add(mintableTokens[currentRound - 201])
                await expectTotalStakeAt(currentRound - 200, total) // late delegator bonds more 1000

                total = total.add(lptAmount(1))
                await expectTotalStakeAt(currentRound - 199, total)
                await expectTotalStakeAt(currentRound - 99, total)
                await expectTotalStakeAt(currentRound, total)
                await expectTotalStakeAt(currentRound + 1, total) // reward called again

                total = total.add(mintableTokens[currentRound + 1])
                await expectTotalStakeAt(currentRound + 2, total)
                await expectTotalStakeAt(currentRound + 3, total)
            })
        })
    })

    describe("corner cases", () => {
        let transcoder
        let delegator
        let currentRound

        before(async () => {
            transcoder = signers[0]
            delegator = signers[1]

            // Initialize the first round ever
            await nextRound(10)

            for (const account of [transcoder, delegator]) {
                await bondingManager.checkpointBondingState(account.address)
            }

            // Round R-1
            await nextRound()

            await bond(transcoder, lptAmount(1), transcoder)
            await bondingManager
                .connect(transcoder)
                .transcoder(50 * PERC_MULTIPLIER, 25 * PERC_MULTIPLIER)

            // Round R
            currentRound = await nextRound()

            // Stop setup now and let sub-tests do their thing
        })

        const expectStakeAt = async (account, round, expected, delegate) => {
            const stakeAndAddress = await bondingVotes.getBondingStateAt(
                account.address,
                round
            )
            assert.equal(
                stakeAndAddress[0].toString(),
                expected.toString(),
                `stake mismatch at round ${round}`
            )
            if (delegate) {
                assert.equal(
                    stakeAndAddress[1].toString(),
                    delegate,
                    `delegate mismatch at round ${round}`
                )
            }
        }

        const totalStakeAt = round =>
            bondingVotes.getTotalActiveStakeAt(round).then(n => n.toString())
        const expectTotalStakeAt = async (round, expected) => {
            assert.equal(
                await totalStakeAt(round),
                expected,
                `total stake mismatch at round ${round}`
            )
        }

        describe("delegator with no stake", () => {
            before(async () => {
                // Round R
                await bond(delegator, lptAmount(1), transcoder)

                // Round R+1
                await nextRound()

                await bondingManager.connect(delegator).unbond(lptAmount(1))

                // Round R+2
                await nextRound()
            })

            it("should not have stake before any bonding", async () => {
                const expectNoStakeAt = r =>
                    expectStakeAt(delegator, r, 0, constants.AddressZero)

                await expectNoStakeAt(currentRound - 1)
                await expectNoStakeAt(currentRound)
            })

            it("should not have stake after unbonding", async () => {
                const testCases = [
                    [delegator, currentRound, 0, constants.AddressZero],
                    [
                        delegator,
                        currentRound + 1,
                        lptAmount(1),
                        transcoder.address
                    ],
                    [delegator, currentRound + 2, 0, constants.AddressZero]
                ]
                for (const [acc, r, expStake, expDel] of testCases) {
                    await expectStakeAt(acc, r, expStake, expDel)
                }
            })
        })

        describe("self-delegated-only active transcoder", () => {
            before(async () => {
                // call reward in a couple of rounds
                for (const r = currentRound; r <= currentRound + 10; r++) {
                    await bondingManager.connect(transcoder).reward()

                    // Rounds R - R+10
                    await nextRound()
                }
            })

            it("should have consistent checkpoints for reward accruing stake", async () => {
                await expectStakeAt(
                    transcoder,
                    currentRound - 1, // bond was made at this round so stake should be 0
                    0,
                    constants.AddressZero
                )

                let expectedStake = lptAmount(1)
                for (const r = currentRound; r <= currentRound + 10; r++) {
                    await expectStakeAt(
                        transcoder,
                        r,
                        expectedStake,
                        transcoder.address
                    )
                    expectedStake = expectedStake.add(mintableTokens[r])
                }
            })
        })

        describe("rounds without initialization", () => {
            before(async () => {
                // Round R
                await bond(delegator, lptAmount(1), transcoder)

                // then let's do a 50 round init gap

                // Round R+50
                const round = await nextRound(50)
                assert.equal(round, currentRound + 50)

                await bondingManager.connect(transcoder).reward()

                // then let's do another 50 round call gap

                // Round R+100
                await nextRound(50)

                // Round R+101
                await nextRound()
            })

            it("should have checkpoints during gap for transcoder", async () => {
                const rewards = mintableTokens[currentRound + 50]
                const testCases = [
                    [currentRound, lptAmount(1)],
                    [currentRound + 1, lptAmount(2)],
                    [currentRound + 2, lptAmount(2)],
                    [currentRound + 50, lptAmount(2)],
                    [currentRound + 51, lptAmount(2).add(rewards)],
                    [currentRound + 75, lptAmount(2).add(rewards)],
                    [currentRound + 100, lptAmount(2).add(rewards)],
                    [currentRound + 101, lptAmount(2).add(rewards)]
                ]
                for (const [round, stake] of testCases) {
                    await expectStakeAt(
                        transcoder,
                        round,
                        stake,
                        transcoder.address
                    )
                }
            })

            it("should have checkpoints during gap for delegator", async () => {
                await expectStakeAt(
                    delegator,
                    currentRound, // bonding was made here so stake is still 0
                    0,
                    constants.AddressZero
                )

                const rewards = math.precise.percOf(
                    mintableTokens[currentRound + 50].div(2), // 50% reward cut
                    lptAmount(1), // delegator stake
                    lptAmount(2) // transcoder stake
                )
                const testCases = [
                    [currentRound + 1, lptAmount(1)],
                    [currentRound + 2, lptAmount(1)],
                    [currentRound + 50, lptAmount(1)],
                    [currentRound + 51, lptAmount(1).add(rewards)],
                    [currentRound + 75, lptAmount(1).add(rewards)],
                    [currentRound + 100, lptAmount(1).add(rewards)],
                    [currentRound + 101, lptAmount(1).add(rewards)]
                ]
                for (const [round, stake] of testCases) {
                    await expectStakeAt(
                        delegator,
                        round,
                        stake,
                        transcoder.address
                    )
                }
            })

            it("should return zero total active stake before the first initialized round", async () => {
                // first checkpointed round was R-2
                for (const i = 3; i <= 10; i++) {
                    const round = currentRound - i
                    await expectTotalStakeAt(round, 0)
                }
            })

            it("should return the next checkpointed round stake on uninitialized rounds", async () => {
                await expectTotalStakeAt(currentRound - 1, 0) // transcoder bonds here
                await expectTotalStakeAt(currentRound, lptAmount(1)) // delegator bonds here

                // initialize gap, return the state at the end of the gap
                await expectTotalStakeAt(currentRound + 1, lptAmount(2))
                await expectTotalStakeAt(currentRound + 25, lptAmount(2))
                await expectTotalStakeAt(currentRound + 49, lptAmount(2))

                // this is initialized round
                await expectTotalStakeAt(currentRound + 50, lptAmount(2)) // transcoder also calls reward here
                const totalStake = lptAmount(2).add(
                    mintableTokens[currentRound + 50]
                )

                // same thing here, the stake from currentRound + 100 will be returned
                await expectTotalStakeAt(currentRound + 51, totalStake)
                await expectTotalStakeAt(currentRound + 75, totalStake)
                await expectTotalStakeAt(currentRound + 99, totalStake)

                // last round to be initialized
                await expectTotalStakeAt(
                    currentRound + 100,
                    lptAmount(2).add(mintableTokens[currentRound + 50])
                )

                // next rounds to be initialized, including current
                await expectTotalStakeAt(currentRound + 100, totalStake)
                await expectTotalStakeAt(currentRound + 101, totalStake)
            })

            it("should return the nextRountTotalActiveStake for rounds after the last initialized", async () => {
                // sanity check
                expect(await roundsManager.currentRound()).to.equal(
                    currentRound + 101
                )

                const totalStake = lptAmount(2).add(
                    mintableTokens[currentRound + 50]
                )
                await expectTotalStakeAt(currentRound + 101, totalStake)
                // this is already the next round, which has the same active stake as the current
                await expectTotalStakeAt(currentRound + 102, totalStake)

                // now add some stake to the system and the next round should return the updated value, which is
                // consistent to what gets returned by the checkpointed bonding state on the next round as well.
                await bond(delegator, lptAmount(1), transcoder)
                await expectTotalStakeAt(
                    currentRound + 102,
                    totalStake.add(lptAmount(1))
                )
            })
        })

        describe("delegator changing delegate address", () => {
            let transcoder2

            const halfLPT = lptAmount(1).div(2)

            before(async () => {
                transcoder2 = signers[3]

                // Round R
                await bond(transcoder2, lptAmount(1), transcoder2)
                await bondingManager
                    .connect(transcoder2)
                    .transcoder(50 * PERC_MULTIPLIER, 25 * PERC_MULTIPLIER)

                await bond(delegator, halfLPT, transcoder)

                // Round R+1
                await nextRound()

                // only transcoder 2 calls reward so delegator migrates on next round
                await bondingManager.connect(transcoder2).reward()

                // Round R+2
                await nextRound()

                await bond(delegator, halfLPT, transcoder2)

                await bondingManager.connect(transcoder2).reward()

                // Round R+3
                await nextRound()

                await bondingManager.connect(transcoder2).reward()

                // Round R+4
                await nextRound()

                await bondingManager.connect(transcoder2).reward()

                // Round R+5
                await nextRound()
            })

            it("should have valid bonded amount and delegate checkpoints", async () => {
                const testCases = [
                    [currentRound, 0, constants.AddressZero],
                    [currentRound + 1, halfLPT, transcoder.address],
                    [currentRound + 2, halfLPT, transcoder.address],
                    [currentRound + 3, lptAmount(1), transcoder2.address],
                    [
                        currentRound + 4,
                        "1122610020423585937", // 1 LPT + rewards
                        transcoder2.address
                    ],
                    [
                        currentRound + 5,
                        "1239149758727968097", // 1 LPT + 2 * rewards
                        transcoder2.address
                    ]
                ]
                for (const [r, expStake, expDel] of testCases) {
                    await expectStakeAt(delegator, r, expStake, expDel)
                }
            })
        })
    })
})
