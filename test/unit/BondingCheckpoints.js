import Fixture from "./helpers/Fixture"
import {functionSig} from "../../utils/helpers"
import {assert} from "chai"
import {ethers, web3} from "hardhat"
import chai from "chai"
import {solidity} from "ethereum-waffle"

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

describe.only("BondingCheckpoints", () => {
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

        describe("getPastVotes", () => {
            it("should return partial rewards for any rounds since bonding", async () => {
                const pendingRewards0 = 250
                const pendingRewards1 = Math.floor(
                    (500 * ((1250 * PERC_DIVISOR) / 3000)) / PERC_DIVISOR
                )

                const votesAt = round =>
                    bondingCheckpoints
                        .getPastVotes(delegator.address, round)
                        .then(n => n.toString())

                assert.equal(await votesAt(1), 0)
                assert.equal(await votesAt(currentRound - 10), 0)
                assert.equal(await votesAt(currentRound - 1), 0)
                assert.equal(await votesAt(currentRound), 1000)
                assert.equal(
                    await votesAt(currentRound + 1),
                    1000 + pendingRewards0
                )
                assert.equal(
                    await votesAt(currentRound + 2),
                    1000 + pendingRewards0 + pendingRewards1
                )
            })

            it("should return partial rewards for all transcoder stake", async () => {
                const votesAt = round =>
                    bondingCheckpoints
                        .getPastVotes(transcoder.address, round)
                        .then(n => n.toString())

                assert.equal(await votesAt(1), 0)
                assert.equal(await votesAt(currentRound - 10), 0)
                // transcoder bonding is only valid on the following round
                assert.equal(await votesAt(currentRound - 2), 0)
                assert.equal(await votesAt(currentRound - 1), 1000)
                assert.equal(await votesAt(currentRound), 2000)
                assert.equal(await votesAt(currentRound + 1), 3000)
                assert.equal(await votesAt(currentRound + 2), 4000)
            })
        })

        describe("getPastTotalSupply", () => {
            const totalSupplyAt = round =>
                bondingCheckpoints
                    .getPastTotalSupply(round)
                    .then(n => n.toString())

            it("should return total stake at any point in time", async () => {
                assert.equal(await totalSupplyAt(1), 0)
                assert.equal(await totalSupplyAt(currentRound - 10), 0)
                assert.equal(await totalSupplyAt(currentRound - 2), 0)
                assert.equal(await totalSupplyAt(currentRound - 1), 1000)
                assert.equal(await totalSupplyAt(currentRound), 2000)
                assert.equal(await totalSupplyAt(currentRound + 1), 3000)
                assert.equal(await totalSupplyAt(currentRound + 2), 4000)
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

            await bondingManager.setNumActiveTranscoders(transcoders.length - 1)

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

        describe("getPastVotes", () => {
            const votesAt = (signer, round) =>
                bondingCheckpoints
                    .connect(signer)
                    .getPastVotes(signer.address, round)
                    .then(n => n.toString())

            it("should allow votes from active and inactive stake delegators", async () => {
                for (const round of testRounds) {
                    for (const i = 0; i < delegators.length; i++) {
                        const delegator = delegators[i]

                        assert.equal(
                            await votesAt(delegator, round),
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
                            await votesAt(transcoder, round),
                            expectedTranscoderStake(i, round),
                            `transcoder ${i} stake mismatch at round ${round}`
                        )
                    }
                }
            })
        })

        describe("getPastTotalSupply", () => {
            const totalSupplyAt = round =>
                bondingCheckpoints
                    .getPastTotalSupply(round)
                    .then(n => n.toString())

            it("should return total supply from only the active stake at any point in time", async () => {
                for (const round of testRounds) {
                    assert.equal(
                        await totalSupplyAt(round),
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
                            .getPastVotes(transcoder.address, round)
                            .then(n => parseInt(n.toString()))
                    }
                    assert.equal(
                        await totalSupplyAt(round),
                        activeStake.toString(),
                        `total supply mismatch at round ${round}`
                    )
                }
            })
        })
    })

    // TODO: more tests, especially some corner cases:
    // - transcoders that have stopped calling reward()
    //   - since a delegator made a bond
    //   - for a long long time (>100 rounds, prev implementation)
    // - delegator with no stake?
    // - transcoder which is the only delegator to itself?
    // - what if some rounds weren't initialized?
    // - migration tests:
    //   - everything still works if we don't call `initBondingCheckpoint`
    //   - when we do call it, checkpoints should work starting on the next round
    //   - make sure it still works even if we init before a transcoder has called reward()
    //   - if we don't call it, it's a known issue that we will only have state starting on the next update made
    // - sorted array tests (separate file)
})
