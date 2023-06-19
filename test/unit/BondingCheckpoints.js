import Fixture from "./helpers/Fixture"
import {functionSig} from "../../utils/helpers"
import {assert} from "chai"
import {ethers, web3} from "hardhat"
import chai from "chai"
import {solidity} from "ethereum-waffle"
import {constants} from "ethers"

chai.use(solidity)

// TODO: to be moved in a separate util/config (i.e: chai-setup)
chai.use(function(chai) {
    const Assertion = chai.Assertion

    Assertion.addMethod("matchStruct", function(expected) {
        // eslint-disable-next-line no-invalid-this
        const obj = this._obj

        Object.keys(expected).forEach(function(key) {
            if (Array.isArray(obj[key])) {
                new Assertion(obj[key]).to.deep.eq(expected[key])
            } else {
                new Assertion(obj[key]).to.eq(expected[key])
            }
        })
    })
})

describe("BondingCheckpoints", () => {
    let fixture
    let bondingManager
    let bondingCheckpoints

    const NUM_ACTIVE_TRANSCODERS = 2
    const UNBONDING_PERIOD = 2

    const PERC_DIVISOR = 1000000
    const PERC_MULTIPLIER = PERC_DIVISOR / 100

    let signers
    before(async () => {
        signers = await ethers.getSigners()
        fixture = new Fixture(web3)
        await fixture.deploy()

        const llFac = await ethers.getContractFactory("SortedDoublyLL")
        const ll = await llFac.deploy()
        const bondingManagerFac = await ethers.getContractFactory(
            "BondingManager",
            {
                libraries: {
                    SortedDoublyLL: ll.address
                }
            }
        )

        bondingManager = await fixture.deployAndRegister(
            bondingManagerFac,
            "BondingManager",
            fixture.controller.address
        )

        await bondingManager.setUnbondingPeriod(UNBONDING_PERIOD)
        await bondingManager.setNumActiveTranscoders(NUM_ACTIVE_TRANSCODERS)

        const bondingCheckpointsFac = await ethers.getContractFactory(
            "BondingCheckpoints"
        )

        bondingCheckpoints = await fixture.deployAndRegister(
            bondingCheckpointsFac,
            "BondingCheckpoints",
            fixture.controller.address
        )
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("scenarios", () => {
        describe("single active transcoder", () => {
            let transcoder
            let delegator
            let currentRound

            beforeEach(async () => {
                transcoder = signers[0]
                delegator = signers[1]
                currentRound = 100

                await fixture.roundsManager.setMockBool(
                    functionSig("currentRoundInitialized()"),
                    true
                )
                await fixture.roundsManager.setMockBool(
                    functionSig("currentRoundLocked()"),
                    false
                )

                const setRound = async round => {
                    await fixture.roundsManager.setMockUint256(
                        functionSig("currentRound()"),
                        round
                    )
                    await fixture.roundsManager.execute(
                        bondingManager.address,
                        functionSig("setCurrentRoundTotalActiveStake()")
                    )
                }

                // Initialize the first round ever
                await setRound(0)

                for (const account of [transcoder, delegator]) {
                    await bondingManager.initBondingCheckpoint(account.address)
                }

                // Round R-2
                await setRound(currentRound - 2)

                await bondingManager
                    .connect(transcoder)
                    .bond(1000, transcoder.address)
                await bondingManager
                    .connect(transcoder)
                    .transcoder(50 * PERC_MULTIPLIER, 25 * PERC_MULTIPLIER)

                // Round R-1
                await setRound(currentRound - 1)

                await bondingManager
                    .connect(delegator)
                    .bond(1000, transcoder.address)

                // Round R
                await setRound(currentRound)

                await fixture.minter.setMockUint256(
                    functionSig("createReward(uint256,uint256)"),
                    1000
                )
                await bondingManager.connect(transcoder).reward()

                // Round R+1
                await setRound(currentRound + 1)

                await bondingManager.connect(transcoder).reward()

                // Round R+2
                await setRound(currentRound + 2)
            })

            describe("getAccountActiveStakeAt", () => {
                it("should return partial rewards for any rounds since bonding", async () => {
                    const pendingRewards0 = 250
                    const pendingRewards1 = Math.floor(
                        (500 * ((1250 * PERC_DIVISOR) / 3000)) / PERC_DIVISOR
                    )

                    const stakeAt = round =>
                        bondingCheckpoints
                            .getAccountActiveStakeAt(delegator.address, round)
                            .then(n => n.toString())

                    assert.equal(await stakeAt(1), 0)
                    assert.equal(await stakeAt(currentRound - 10), 0)
                    assert.equal(await stakeAt(currentRound - 1), 0)
                    assert.equal(await stakeAt(currentRound), 1000)
                    assert.equal(
                        await stakeAt(currentRound + 1),
                        1000 + pendingRewards0
                    )
                    assert.equal(
                        await stakeAt(currentRound + 2),
                        1000 + pendingRewards0 + pendingRewards1
                    )
                })

                it("should return partial rewards for all transcoder stake", async () => {
                    const stakeAt = round =>
                        bondingCheckpoints
                            .getAccountActiveStakeAt(transcoder.address, round)
                            .then(n => n.toString())

                    assert.equal(await stakeAt(1), 0)
                    assert.equal(await stakeAt(currentRound - 10), 0)
                    // transcoder bonding is only valid on the following round
                    assert.equal(await stakeAt(currentRound - 2), 0)
                    assert.equal(await stakeAt(currentRound - 1), 1000)
                    assert.equal(await stakeAt(currentRound), 2000)
                    assert.equal(await stakeAt(currentRound + 1), 3000)
                    assert.equal(await stakeAt(currentRound + 2), 4000)
                })
            })

            describe("getTotalActiveStakeAt", () => {
                const totalStakeAt = round =>
                    bondingCheckpoints
                        .getTotalActiveStakeAt(round)
                        .then(n => n.toString())

                it("should return total stake at any point in time", async () => {
                    assert.equal(await totalStakeAt(1), 0)
                    assert.equal(await totalStakeAt(currentRound - 10), 0)
                    assert.equal(await totalStakeAt(currentRound - 2), 0)
                    assert.equal(await totalStakeAt(currentRound - 1), 1000)
                    assert.equal(await totalStakeAt(currentRound), 2000)
                    assert.equal(await totalStakeAt(currentRound + 1), 3000)
                    assert.equal(await totalStakeAt(currentRound + 2), 4000)
                })
            })
        })

        describe("inactive transcoders with stake", () => {
            let transcoders = []
            let activeTranscoders = []
            let delegators = []
            const currentRound = 100
            const testRounds = [1, 90, 98, 99, 100, 101, 102]

            beforeEach(async () => {
                transcoders = signers.slice(0, 5)
                activeTranscoders = signers.slice(0, 4)
                delegators = signers.slice(5, 10)

                await fixture.roundsManager.setMockBool(
                    functionSig("currentRoundInitialized()"),
                    true
                )
                await fixture.roundsManager.setMockBool(
                    functionSig("currentRoundLocked()"),
                    false
                )

                const setRound = async round => {
                    await fixture.roundsManager.setMockUint256(
                        functionSig("currentRound()"),
                        round
                    )
                    await fixture.roundsManager.execute(
                        bondingManager.address,
                        functionSig("setCurrentRoundTotalActiveStake()")
                    )
                }

                // Initialize the first round ever
                await setRound(0)

                await bondingManager.setNumActiveTranscoders(
                    transcoders.length - 1
                )

                for (const account of [...transcoders, ...delegators]) {
                    await bondingManager.initBondingCheckpoint(account.address)
                }

                // Round R-2
                await setRound(currentRound - 2)

                for (const transcoder of transcoders) {
                    await bondingManager
                        .connect(transcoder)
                        .bond(1000, transcoder.address)
                    await bondingManager
                        .connect(transcoder)
                        .transcoder(50 * PERC_MULTIPLIER, 25 * PERC_MULTIPLIER)
                }

                // Round R-1
                await setRound(currentRound - 1)

                // Distribute stake progressively so the last T is always inactive
                const amount = 500
                for (const i = 0; i < delegators.length; i++) {
                    const delegator = delegators[i]
                    await bondingManager
                        .connect(delegator)
                        .bond(amount, transcoders[i].address)
                    amount -= 100
                }

                // Round R
                await setRound(currentRound)

                await fixture.minter.setMockUint256(
                    functionSig("createReward(uint256,uint256)"),
                    1000
                )
                for (const transcoder of activeTranscoders) {
                    await bondingManager.connect(transcoder).reward()
                }

                // Round R+1
                await setRound(currentRound + 1)

                for (const transcoder of activeTranscoders) {
                    await bondingManager.connect(transcoder).reward()
                }

                // Round R+2
                await setRound(currentRound + 2)
            })

            const expectedDelegatorStake = (idx, endRound) => {
                if (endRound < currentRound) {
                    return 0
                } else if (idx === 4) {
                    // last delegator doesn't get rewards from the inactive transcoder
                    return 100
                }

                let rewardFactor = PERC_DIVISOR
                for (let round = currentRound; round < endRound; round++) {
                    // transcoders distribute 50% of the 1000 rewards
                    const transcoderStake = expectedTranscoderStake(idx, round)
                    const currRewardPerc = Math.floor(
                        (500 * PERC_DIVISOR) / transcoderStake
                    )
                    rewardFactor += Math.floor(
                        (rewardFactor * currRewardPerc) / PERC_DIVISOR
                    )
                }

                const initialBond = 500 - 100 * idx
                return Math.floor((initialBond * rewardFactor) / PERC_DIVISOR)
            }

            const expectedTranscoderStake = (idx, endRound) => {
                if (endRound < currentRound - 1) {
                    // transcoder self bond starts on currentRound-1
                    return 0
                } else if (endRound === currentRound - 1) {
                    // delegator bond only starts on currentRound
                    return 1000
                }

                const delegation = 500 - 100 * idx
                const rewardCalls =
                    idx === 4 ? 0 : Math.max(endRound - currentRound, 0)
                return 1000 + delegation + 1000 * rewardCalls
            }

            const expectedTotalSupply = endRound => {
                if (endRound < currentRound - 1) {
                    return 0
                } else if (endRound === currentRound - 1) {
                    // only transcoders bonded at this point (inactive doesn't count)
                    return 4000
                }

                const delegations = 1400 // 500 + 400 + 300 + 200 (doesn't include inactive delegator)
                const rewardCalls = 4 * Math.max(endRound - currentRound, 0)
                return 4000 + delegations + 1000 * rewardCalls
            }

            it("should have all active transcoders but the last one", async () => {
                const isActive = a => bondingManager.isActiveTranscoder(a)
                for (const transcoder of activeTranscoders) {
                    assert.isTrue(await isActive(transcoder.address))
                }

                const inactiveTranscoder = transcoders[4]
                assert.isFalse(await isActive(inactiveTranscoder.address))
            })

            describe("getAccountActiveStakeAt", () => {
                const stakeAt = (signer, round) =>
                    bondingCheckpoints
                        .connect(signer)
                        .getAccountActiveStakeAt(signer.address, round)
                        .then(n => n.toString())

                it("should allow votes from active and inactive stake delegators", async () => {
                    for (const round of testRounds) {
                        for (const i = 0; i < delegators.length; i++) {
                            const delegator = delegators[i]

                            assert.equal(
                                await stakeAt(delegator, round),
                                expectedDelegatorStake(i, round),
                                `delegator ${i} stake mismatch at round ${round}`
                            )
                        }
                    }
                })

                it("should return partial rewards for all transcoder stake", async () => {
                    for (const round of testRounds) {
                        for (const i = 0; i < transcoders.length; i++) {
                            const transcoder = transcoders[i]
                            assert.equal(
                                await stakeAt(transcoder, round),
                                expectedTranscoderStake(i, round),
                                `transcoder ${i} stake mismatch at round ${round}`
                            )
                        }
                    }
                })
            })

            describe("getTotalActiveStakeAt", () => {
                const totalStakeAt = round =>
                    bondingCheckpoints
                        .getTotalActiveStakeAt(round)
                        .then(n => n.toString())

                it("should return total supply from only the active stake at any point in time", async () => {
                    for (const round of testRounds) {
                        assert.equal(
                            await totalStakeAt(round),
                            expectedTotalSupply(round),
                            `total supply mismatch at round ${round}`
                        )
                    }
                })

                it("should actually match the sum of all active transcoders stake", async () => {
                    for (const round of testRounds) {
                        let activeStake = 0
                        for (const transcoder of activeTranscoders) {
                            activeStake += await bondingCheckpoints
                                .getAccountActiveStakeAt(
                                    transcoder.address,
                                    round
                                )
                                .then(n => parseInt(n.toString()))
                        }
                        assert.equal(
                            await totalStakeAt(round),
                            activeStake.toString(),
                            `total supply mismatch at round ${round}`
                        )
                    }
                })
            })
        })
    })

    describe("intermittent reward-calling transcoder", () => {
        let transcoder
        let delegatorEarly
        let delegator
        let currentRound

        beforeEach(async () => {
            transcoder = signers[0]
            delegator = signers[1]
            delegatorEarly = signers[2]
            currentRound = 1000

            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                true
            )
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundLocked()"),
                false
            )

            const setRound = async round => {
                await fixture.roundsManager.setMockUint256(
                    functionSig("currentRound()"),
                    round
                )
                await fixture.roundsManager.execute(
                    bondingManager.address,
                    functionSig("setCurrentRoundTotalActiveStake()")
                )
            }

            // Initialize the first round ever
            await setRound(0)

            for (const account of [transcoder, delegator, delegatorEarly]) {
                await bondingManager.initBondingCheckpoint(account.address)
            }

            // Round R-200
            await setRound(currentRound - 200)

            await bondingManager
                .connect(transcoder)
                .bond(1000, transcoder.address)
            await bondingManager
                .connect(transcoder)
                .transcoder(50 * PERC_MULTIPLIER, 25 * PERC_MULTIPLIER)

            await bondingManager
                .connect(delegatorEarly)
                .bond(1000, transcoder.address)

            // Round R-199
            await setRound(currentRound - 199)

            await fixture.minter.setMockUint256(
                functionSig("createReward(uint256,uint256)"),
                1000
            )
            await bondingManager.connect(transcoder).reward()

            // Round R-198
            await setRound(currentRound - 198)

            await bondingManager
                .connect(delegator)
                .bond(1000, transcoder.address)

            // Round R-197
            await setRound(currentRound - 197)

            // We need to initialize this round so the total active stake with the above bond is checkpointed.

            // Now hibernate far away into the future...

            // Round R
            await setRound(currentRound)

            // Round R+1
            await setRound(currentRound + 1)

            await bondingManager.connect(transcoder).reward()

            // Round R+2
            await setRound(currentRound + 2)

            // Round R+3
            await setRound(currentRound + 3)
        })

        describe("getAccountActiveStakeAt", () => {
            const stakeAt = (account, round) =>
                bondingCheckpoints
                    .getAccountActiveStakeAt(account.address, round)
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

        const setRound = async round => {
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                round
            )
            await fixture.roundsManager.execute(
                bondingManager.address,
                functionSig("setCurrentRoundTotalActiveStake()")
            )
        }

        beforeEach(async () => {
            transcoder = signers[0]
            delegator = signers[1]
            currentRound = 100

            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                true
            )
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundLocked()"),
                false
            )

            // Initialize the first round ever
            await setRound(0)

            for (const account of [transcoder, delegator]) {
                await bondingManager.initBondingCheckpoint(account.address)
            }

            // Round R-1
            await setRound(currentRound - 1)

            await bondingManager
                .connect(transcoder)
                .bond(1000, transcoder.address)
            await bondingManager
                .connect(transcoder)
                .transcoder(50 * PERC_MULTIPLIER, 25 * PERC_MULTIPLIER)

            await fixture.minter.setMockUint256(
                functionSig("createReward(uint256,uint256)"),
                1000
            )

            // Stop setup now and let sub-tests do their thing
        })

        const stakeAt = (account, round) =>
            bondingCheckpoints
                .getAccountActiveStakeAt(account.address, round)
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
            it("should have not have stake in any rounds", async () => {
                for (const r = currentRound - 10; r < currentRound; r++) {
                    await expectStakeAt(delegator, r, 0, constants.AddressZero)
                }
            })

            describe("after unbonding", () => {
                beforeEach(async () => {
                    // Round R
                    await setRound(currentRound)

                    await bondingManager
                        .connect(delegator)
                        .bond(1000, transcoder.address)

                    // Round R+1
                    setRound(currentRound + 1)

                    await bondingManager.connect(delegator).unbond(1000)

                    // Round R+2
                    setRound(currentRound + 2)
                })

                it("should have not have stake in any rounds", async () => {
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
                    // Rounds R - R+10
                    await setRound(r)

                    await bondingManager.connect(transcoder).reward()
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
                await setRound(currentRound)

                await bondingManager
                    .connect(delegator)
                    .bond(1000, transcoder.address)

                // then let's do a 50 round init gap
                // Round R+50
                await setRound(currentRound + 50)

                await bondingManager.connect(transcoder).reward()

                // then let's do another 50 round call gap

                // Round R+100
                await setRound(currentRound + 100)

                // Round R+101
                await setRound(currentRound + 101)
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
                await setRound(currentRound)

                await bondingManager
                    .connect(transcoder2)
                    .bond(1000, transcoder2.address)
                await bondingManager
                    .connect(transcoder2)
                    .transcoder(50 * PERC_MULTIPLIER, 25 * PERC_MULTIPLIER)

                await bondingManager
                    .connect(delegator)
                    .bond(500, transcoder.address)

                // Round R+1
                setRound(currentRound + 1)

                await bondingManager.connect(transcoder2).reward()

                // Round R+2
                setRound(currentRound + 2)

                await bondingManager
                    .connect(delegator)
                    .bond(500, transcoder2.address)

                await bondingManager.connect(transcoder2).reward()

                // Round R+3
                setRound(currentRound + 3)

                await bondingManager.connect(transcoder2).reward()

                // Round R+4
                setRound(currentRound + 4)

                await bondingManager.connect(transcoder2).reward()

                // Round R+5
                setRound(currentRound + 5)
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

    // TODO: more tests:
    // - migration tests:
    //   - everything still works if we don't call `initBondingCheckpoint`
    //   - when we do call it, checkpoints should work starting on the next round
    //   - make sure it still works even if we init before a transcoder has called reward()
    //   - if we don't call it, it's a known issue that we will only have state starting on the next update made
    // - sorted array tests (separate file)
})
