import setupIntegrationTest from "../helpers/setupIntegrationTest"

import chai, {assert} from "chai"
import {ethers} from "hardhat"
import {solidity} from "ethereum-waffle"
import {BigNumber, constants} from "ethers"

import math from "../helpers/math"

chai.use(solidity)

describe.only("BondingCheckpoints", () => {
    let signers
    let bondingCheckpoints
    let bondingManager
    let roundsManager
    let roundLength
    let token
    let minter

    const PERC_DIVISOR = 1000000
    const PERC_MULTIPLIER = PERC_DIVISOR / 100

    const lptAmount = amount => ethers.utils.parseEther("1").mul(amount)

    // We define a function instead of a before() hook so each test group can re-create the environment and set up its
    // own testing scenario
    async function setupTest() {
        signers = await ethers.getSigners()
        const fixture = await setupIntegrationTest()

        bondingManager = await ethers.getContractAt(
            "BondingManager",
            fixture.BondingManager.address
        )

        bondingCheckpoints = await ethers.getContractAt(
            "BondingCheckpoints",
            fixture.BondingCheckpoints.address
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
            await setupTest()

            transcoder = signers[0]
            delegator = signers[1]

            // Initialize the first round ever
            await nextRound()

            for (const account of [transcoder, delegator]) {
                await bondingManager.checkpointBonding(account.address)
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

        describe("getAccountStakeAt", () => {
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
                    bondingCheckpoints
                        .getAccountStakeAt(delegator.address, round)
                        .then(n => n.toString())

                assert.equal(await stakeAt(2), 0)
                assert.equal(await stakeAt(currentRound - 1), 0)

                let stake = lptAmount(1) // bonded on previous round
                assert.equal(await stakeAt(currentRound), stake)

                stake = stake.add(pendingRewards0) // reward call
                assert.equal(await stakeAt(currentRound + 1), stake)

                stake = stake.add(pendingRewards1) // reward call
                assert.equal(await stakeAt(currentRound + 2), stake)
            })

            it("should return partial rewards for all transcoder stake", async () => {
                const stakeAt = round =>
                    bondingCheckpoints
                        .getAccountStakeAt(transcoder.address, round)
                        .then(n => n.toString())

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
                bondingCheckpoints
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

    describe.only("inactive transcoders with stake", () => {
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
            await setupTest()

            // migrations.config.ts defines default net numActiveTranscoders as 10
            activeTranscoders = signers.slice(0, 10)
            transcoders = signers.slice(0, 11)
            delegators = signers.slice(12, 23)

            // Initialize the first round ever
            await nextRound()

            for (const account of [...transcoders, ...delegators]) {
                await bondingManager.checkpointBonding(account.address)
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

        describe("getAccountStakeAt", () => {
            it("should provide voting power even for inactive transcoders and their delegators", async () => {
                const transcoder = transcoders[transcoders.length - 1].address
                const delegator = delegators[delegators.length - 1].address

                const testHasStake = async (address, round) => {
                    const stake = await bondingCheckpoints.getAccountStakeAt(
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

                        const stakeCheckpoint =
                            await bondingCheckpoints.getAccountStakeAt(
                                address,
                                round
                            )
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
                        await bondingCheckpoints.getTotalActiveStakeAt(round)
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
                        const stake =
                            await bondingCheckpoints.getAccountStakeAt(
                                transcoder.address,
                                r
                            )
                        activeStakeSum = activeStakeSum.add(stake)
                    }

                    const totalStake =
                        await bondingCheckpoints.getTotalActiveStakeAt(r)
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
            await setupTest()

            transcoder = signers[0]
            delegator = signers[1]
            delegatorEarly = signers[2]
            currentRound = 1000

            // Initialize the first round ever
            await nextRound()

            for (const account of [transcoder, delegator, delegatorEarly]) {
                await bondingManager.checkpointBonding(account.address)
            }

            // Round R-202
            await nextRound()

            await bond(transcoder, 1000, transcoder)
            await bondingManager
                .connect(transcoder)
                .transcoder(50 * PERC_MULTIPLIER, 25 * PERC_MULTIPLIER)

            await bond(delegatorEarly, 1000, transcoder)

            // Round R-201
            await nextRound()

            await bondingManager.connect(transcoder).reward()

            // Round R-200
            await nextRound()

            await bond(delegator, 1000, transcoder)

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

        describe("getAccountStakeAt", () => {
            const stakeAt = (account, round) =>
                bondingCheckpoints
                    .getAccountStakeAt(account.address, round)
                    .then(n => n.toString())
            const expectStakeAt = async (account, round, expected) => {
                assert.equal(
                    await stakeAt(account, round),
                    expected,
                    `stake mismatch at round ${round}`
                )
            }

            it("consistent stake for delegator that had never observed a reward on the call gap", async () => {
                const pendingRewards0 = 125 // ~ 500 * 1000 / 4000

                await expectStakeAt(delegator, currentRound - 198, 0) // bond made on this round
                await expectStakeAt(delegator, currentRound - 197, 1000) // transcoder is gone from here until currRound+1
                await expectStakeAt(delegator, currentRound - 99, 1000)
                await expectStakeAt(delegator, currentRound, 1000)
                await expectStakeAt(delegator, currentRound + 1, 1000) // reward is called again here
                await expectStakeAt(
                    delegator,
                    currentRound + 2,
                    1000 + pendingRewards0 // 1125
                )
                await expectStakeAt(delegator, currentRound + 3, 1125)
            })

            it("consistent stake for delegator that had unclaimed rewards", async () => {
                const pendingRewards0 = 250 // ~ 500 * 1000 / 2000
                const pendingRewards1 = 156 // ~ 500 * 1250 / 4000

                await expectStakeAt(delegatorEarly, currentRound - 200, 0) // bond is already made here
                await expectStakeAt(
                    delegatorEarly,
                    currentRound - 199, // reward is called first time
                    1000
                )
                await expectStakeAt(
                    delegatorEarly,
                    currentRound - 198,
                    1000 + pendingRewards0 // 1250
                )
                await expectStakeAt(delegatorEarly, currentRound - 197, 1250) // transcoder is gone from here until currRound+1
                await expectStakeAt(delegatorEarly, currentRound - 99, 1250)
                await expectStakeAt(delegatorEarly, currentRound, 1250)
                await expectStakeAt(delegatorEarly, currentRound + 1, 1250) // reward called again
                await expectStakeAt(
                    delegatorEarly,
                    currentRound + 2,
                    1000 + pendingRewards0 + pendingRewards1 // 1406
                )
                await expectStakeAt(delegatorEarly, currentRound + 3, 1406)
            })

            it("for the intermittent transcoder itself", async () => {
                await expectStakeAt(transcoder, currentRound - 200, 0) // both transcoder and delegator bond 1000
                await expectStakeAt(transcoder, currentRound - 199, 2000) // reward is called first time
                await expectStakeAt(transcoder, currentRound - 198, 3000) // late delegator bonds more 1000
                await expectStakeAt(transcoder, currentRound - 197, 4000)
                await expectStakeAt(transcoder, currentRound - 99, 4000)
                await expectStakeAt(transcoder, currentRound, 4000)
                await expectStakeAt(transcoder, currentRound + 1, 4000) // reward called again
                await expectStakeAt(transcoder, currentRound + 2, 5000)
                await expectStakeAt(transcoder, currentRound + 3, 5000)
            })
        })

        describe("getTotalActiveStakeAt", () => {
            const totalStakeAt = round =>
                bondingCheckpoints
                    .getTotalActiveStakeAt(round)
                    .then(n => n.toString())
            const expectTotalStakeAt = async (round, expected) => {
                assert.equal(
                    await totalStakeAt(round),
                    expected,
                    `total stake mismatch at round ${round}`
                )
            }

            it("on the total stake as well", async () => {
                await expectTotalStakeAt(currentRound - 200, 0) // both transcoder and delegator bond 1000
                await expectTotalStakeAt(currentRound - 199, 2000) // reward is called first time
                await expectTotalStakeAt(currentRound - 198, 3000) // late delegator bonds more 1000
                await expectTotalStakeAt(currentRound - 197, 4000)
                await expectTotalStakeAt(currentRound - 99, 4000)
                await expectTotalStakeAt(currentRound, 4000)
                await expectTotalStakeAt(currentRound + 1, 4000) // reward called again
                await expectTotalStakeAt(currentRound + 2, 5000)
                await expectTotalStakeAt(currentRound + 3, 5000)
            })
        })
    })

    describe("corner cases", () => {
        let transcoder
        let delegator
        let currentRound

        before(async () => {
            await setupTest()

            transcoder = signers[0]
            delegator = signers[1]

            // Initialize the first round ever
            await nextRound()

            for (const account of [transcoder, delegator]) {
                await bondingManager.checkpointBonding(account.address)
            }

            // Round R-1
            await nextRound()

            await bond(transcoder, 1000, transcoder)
            await bondingManager
                .connect(transcoder)
                .transcoder(50 * PERC_MULTIPLIER, 25 * PERC_MULTIPLIER)

            // Round R
            currentRound = await nextRound()

            // Stop setup now and let sub-tests do their thing
        })

        const stakeAt = (account, round) =>
            bondingCheckpoints
                .getAccountStakeAt(account.address, round)
                .then(n => n.toString())
        const delegateAt = (account, round) =>
            bondingCheckpoints
                .getDelegateAddressAt(account.address, round)
                .then(n => n.toString())
        const expectStakeAt = async (account, round, expected, delegate) => {
            assert.equal(
                await stakeAt(account, round),
                expected,
                `stake mismatch at round ${round}`
            )
            if (delegate) {
                assert.equal(
                    await delegateAt(account, round),
                    delegate,
                    `unexpected delegate at round ${round}`
                )
            }
        }

        const totalStakeAt = round =>
            bondingCheckpoints
                .getTotalActiveStakeAt(round)
                .then(n => n.toString())
        const expectTotalStakeAt = async (round, expected) => {
            assert.equal(
                await totalStakeAt(round),
                expected,
                `total stake mismatch at round ${round}`
            )
        }

        describe("delegator with no stake", () => {
            it("should not have stake in any rounds", async () => {
                for (const r = currentRound - 10; r <= currentRound; r++) {
                    await expectStakeAt(delegator, r, 0, constants.AddressZero)
                }
            })

            describe("after unbonding", () => {
                it("should have not have stake in any rounds", async () => {
                    // Round R
                    await bond(delegator, 1000, transcoder)

                    // Round R+1
                    await nextRound()

                    await bondingManager.connect(delegator).unbond(1000)

                    // Round R+2
                    await nextRound()

                    const testCases = [
                        [delegator, currentRound, 0, constants.AddressZero],
                        [delegator, currentRound + 1, 1000, transcoder.address],
                        [delegator, currentRound + 2, 0, constants.AddressZero]
                    ]
                    for (const [acc, r, expStake, expDel] of testCases) {
                        await expectStakeAt(acc, r, expStake, expDel)
                    }
                })
            })
        })

        describe("self-delegated-only active transcoder", () => {
            beforeEach(async () => {
                // call reward in a couple of rounds
                for (const r = currentRound; r <= currentRound + 10; r++) {
                    await bondingManager.connect(transcoder).reward()

                    // Rounds R - R+10
                    await nextRound()
                }
            })

            it("should have consistent checkpoints for normally accruing stake", async () => {
                for (const r = currentRound - 10; r <= currentRound + 10; r++) {
                    const expectedStake =
                        1000 * Math.max(0, r - currentRound + 1) // 1000 at round R, 2000 at round R+1, etc.
                    const expectedDelegate =
                        expectedStake > 0 ?
                            transcoder.address :
                            constants.AddressZero
                    await expectStakeAt(
                        transcoder,
                        r,
                        expectedStake,
                        expectedDelegate
                    )
                }
            })
        })

        describe("rounds without initialization", () => {
            beforeEach(async () => {
                // Round R
                await bond(delegator, 1000, transcoder)

                // then let's do a 50 round init gap

                // Round R+50
                await nextRound(50)

                await bondingManager.connect(transcoder).reward()

                // then let's do another 50 round call gap

                // Round R+100
                await nextRound(50)

                // Round R+101
                await nextRound()
            })

            it("should have checkpoints during gap for transcoder", async () => {
                const testCases = [
                    [transcoder, currentRound, 1000, transcoder.address],
                    [transcoder, currentRound + 1, 2000, transcoder.address],
                    [transcoder, currentRound + 2, 2000, transcoder.address],
                    [transcoder, currentRound + 50, 2000, transcoder.address],
                    [transcoder, currentRound + 51, 3000, transcoder.address],
                    [transcoder, currentRound + 75, 3000, transcoder.address],
                    [transcoder, currentRound + 100, 3000, transcoder.address],
                    [transcoder, currentRound + 101, 3000, transcoder.address]
                ]
                for (const [acc, r, expStake, expDel] of testCases) {
                    await expectStakeAt(acc, r, expStake, expDel)
                }
            })

            it("should have checkpoints during gap for delegator", async () => {
                const testCases = [
                    [delegator, currentRound, 0, constants.AddressZero],
                    [delegator, currentRound + 1, 1000, transcoder.address],
                    [delegator, currentRound + 2, 1000, transcoder.address],
                    [delegator, currentRound + 50, 1000, transcoder.address],
                    [delegator, currentRound + 51, 1250, transcoder.address],
                    [delegator, currentRound + 75, 1250, transcoder.address],
                    [delegator, currentRound + 100, 1250, transcoder.address],
                    [delegator, currentRound + 101, 1250, transcoder.address]
                ]
                for (const [acc, r, expStake, expDel] of testCases) {
                    await expectStakeAt(acc, r, expStake, expDel)
                }
            })

            // This is a test for a known corner case in the implementation: Since we only initialize the total active
            // stake checkpoint on the `initializeRound` flow, if a round is not initialized we won't have a checkpoint
            // of the active stake on that round and will use the info from the last checkpointed round instead.
            //
            // The practical effect of this is that if you query for the total active stake of a round that hasn't been
            // initialized, you will get a value that is not equal to the sum of the active stake of all transcoders in
            // the active set. Observe in the test below how the "total stake" is reported as a lower value than the
            // "transcoder stake" on the corresponding rounds in the above tests. In practice this is only an issue if
            // we ever get rounds not being initialized at some point, which seems like a bigger issue itself.
            //
            // This could be fixed in the code by checkpointing the "next round active stake" instead, every time it
            // changes instead, but it means more storage writes and complexity in BondingManager code.
            it("should only update total active stake on the next initialized round", async () => {
                expectTotalStakeAt(currentRound, 1000)
                expectTotalStakeAt(currentRound + 1, 1000) // this should be 2000 since the delegator bonded on the previous round
                expectTotalStakeAt(currentRound + 25, 1000)
                expectTotalStakeAt(currentRound + 50, 2000) // only when a round is initialized it picks up the change
                expectTotalStakeAt(currentRound + 51, 2000) // this should be 2000 since the transcoder called reward on the previous round
                expectTotalStakeAt(currentRound + 75, 2000)
                expectTotalStakeAt(currentRound + 100, 3000) // same thing here, only picks up the change on initRound
            })
        })

        describe("delegator changing delegate address", () => {
            let transcoder2

            beforeEach(async () => {
                transcoder2 = signers[3]

                // Round R
                await bond(transcoder2, 1000, transcoder2)
                await bondingManager
                    .connect(transcoder2)
                    .transcoder(50 * PERC_MULTIPLIER, 25 * PERC_MULTIPLIER)

                await bond(delegator, 500, transcoder)

                // Round R+1
                await nextRound()

                await bondingManager.connect(transcoder2).reward()

                // Round R+2
                await nextRound()

                await bond(delegator, 500, transcoder2)

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
                    [delegator, currentRound, 0, constants.AddressZero],
                    [delegator, currentRound + 1, 500, transcoder.address],
                    [delegator, currentRound + 2, 500, transcoder.address],
                    [delegator, currentRound + 3, 1000, transcoder2.address],
                    [delegator, currentRound + 4, 1125, transcoder2.address], // 1000 + 500 * 1000 / 4000
                    [delegator, currentRound + 5, 1237, transcoder2.address] // 1125 + 500 * 1125 / 5000
                ]
                for (const [acc, r, expStake, expDel] of testCases) {
                    await expectStakeAt(acc, r, expStake, expDel)
                }
            })
        })
    })
})
