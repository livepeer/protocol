import Fixture from "./helpers/Fixture"
import {
    contractId,
    functionSig,
    functionEncodedABI
} from "../../utils/helpers"
import expectCheckpoints from "./helpers/expectCheckpoints"
import {constants} from "../../utils/constants"
import math from "../helpers/math"
import {assert} from "chai"
import {ethers, web3} from "hardhat"
const BigNumber = ethers.BigNumber
import chai from "chai"
import {solidity} from "ethereum-waffle"

chai.use(solidity)
const {expect} = chai
const {DelegatorStatus, TranscoderStatus} = constants

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

describe("BondingManager", () => {
    let fixture
    let bondingManager

    const NUM_ACTIVE_TRANSCODERS = 2
    const UNBONDING_PERIOD = 2

    const PERC_DIVISOR = 1000000
    const PERC_MULTIPLIER = PERC_DIVISOR / 100

    const ZERO_ADDRESS = ethers.constants.AddressZero

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
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("setController", () => {
        it("should fail if caller is not Controller", async () => {
            await expect(
                bondingManager.setController(signers[0].address)
            ).to.be.revertedWith("caller must be Controller")
        })

        it("should set new Controller", async () => {
            await fixture.controller.updateController(
                contractId("BondingManager"),
                signers[0].address
            )

            assert.equal(
                await bondingManager.controller(),
                signers[0].address,
                "should set new Controller"
            )
        })
    })

    describe("setUnbondingPeriod", () => {
        it("should fail if caller is not Controller owner", async () => {
            await expect(
                bondingManager.connect(signers[2]).setUnbondingPeriod(5)
            ).to.be.revertedWith("caller must be Controller owner")
        })

        it("should set unbondingPeriod", async () => {
            await bondingManager.setUnbondingPeriod(5)

            assert.equal(
                await bondingManager.unbondingPeriod(),
                5,
                "wrong unbondingPeriod"
            )
        })
    })

    describe("setNumActiveTranscoders", () => {
        it("should fail if caller is not Controller owner", async () => {
            await expect(
                bondingManager.connect(signers[2]).setNumActiveTranscoders(7)
            ).to.be.revertedWith("caller must be Controller owner")
        })

        it("should set numActiveTranscoders", async () => {
            await bondingManager.setNumActiveTranscoders(4)

            assert.equal(
                await bondingManager.getTranscoderPoolMaxSize(),
                4,
                "wrong numActiveTranscoders"
            )
        })
    })

    describe("setTreasuryRewardCutRate", () => {
        const FIFTY_PCT = math.precise.percPoints(BigNumber.from(50), 100)

        let currentRound

        beforeEach(async () => {
            currentRound = 100

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound
            )
        })

        it("should start as zero", async () => {
            assert.equal(
                await bondingManager.treasuryRewardCutRate(),
                0,
                "initial treasuryRewardCutRate not zero"
            )
        })

        it("should fail if caller is not Controller owner", async () => {
            await expect(
                bondingManager
                    .connect(signers[2])
                    .setTreasuryRewardCutRate(FIFTY_PCT)
            ).to.be.revertedWith("caller must be Controller owner")
        })

        it("should set only nextRoundTreasuryRewardCutRate", async () => {
            const tx = await bondingManager.setTreasuryRewardCutRate(FIFTY_PCT)
            await expect(tx)
                .to.emit(bondingManager, "ParameterUpdate")
                .withArgs("nextRoundTreasuryRewardCutRate")

            assert.equal(
                await bondingManager.nextRoundTreasuryRewardCutRate(),
                FIFTY_PCT.toString(),
                "wrong nextRoundTreasuryRewardCutRate"
            )
            assert.equal(
                await bondingManager.treasuryRewardCutRate(),
                0,
                "wrong treasuryRewardCutRate"
            )
        })

        it("should set treasuryRewardCutRate on the next round", async () => {
            await bondingManager.setTreasuryRewardCutRate(FIFTY_PCT)

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 1
            )
            const tx = await fixture.roundsManager.execute(
                bondingManager.address,
                functionSig("setCurrentRoundTotalActiveStake()")
            )
            await expect(tx)
                .to.emit(bondingManager, "ParameterUpdate")
                .withArgs("treasuryRewardCutRate")

            assert.equal(
                await bondingManager.treasuryRewardCutRate(),
                FIFTY_PCT.toString(),
                "wrong treasuryRewardCutRate"
            )
            // sanity check that this hasn't changed either
            assert.equal(
                await bondingManager.nextRoundTreasuryRewardCutRate(),
                FIFTY_PCT.toString(),
                "wrong nextRoundTreasuryRewardCutRate"
            )
        })
    })

    describe("setTreasuryBalanceCeiling", () => {
        const HUNDRED_LPT = ethers.utils.parseEther("100")

        it("should start as zero", async () => {
            assert.equal(
                await bondingManager.treasuryBalanceCeiling(),
                0,
                "initial treasuryBalanceCeiling not zero"
            )
        })

        it("should fail if caller is not Controller owner", async () => {
            await expect(
                bondingManager
                    .connect(signers[2])
                    .setTreasuryBalanceCeiling(HUNDRED_LPT)
            ).to.be.revertedWith("caller must be Controller owner")
        })

        it("should set treasuryBalanceCeiling", async () => {
            await bondingManager.setTreasuryBalanceCeiling(HUNDRED_LPT)

            const newValue = await bondingManager.treasuryBalanceCeiling()
            assert.equal(
                newValue.toString(),
                HUNDRED_LPT.toString(),
                "wrong treasuryBalanceCeiling"
            )
        })
    })

    describe("transcoder", () => {
        const currentRound = 100
        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                true
            )
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundLocked()"),
                false
            )
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound
            )
        })

        it("should fail if current round is not initialized", async () => {
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                false
            )

            await expect(bondingManager.transcoder(5, 10)).to.be.revertedWith(
                "current round is not initialized"
            )
        })

        it("should fail if the current round is locked", async () => {
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundLocked()"),
                true
            )

            await expect(bondingManager.transcoder(5, 10)).to.be.revertedWith(
                "can't update transcoder params, current round is locked"
            )
        })

        it("should fail if rewardCut is not a valid percentage <= 100%", async () => {
            await expect(
                bondingManager.transcoder(PERC_DIVISOR + 1, 10)
            ).to.be.revertedWith("invalid rewardCut percentage")
        })

        it("should fail if feeShare is not a valid percentage <= 100%", async () => {
            await expect(
                bondingManager.transcoder(5, PERC_DIVISOR + 1)
            ).to.be.revertedWith("invalid feeShare percentage")
        })

        describe("transcoder is not already registered", () => {
            it("should fail if caller is not delegated to self with a non-zero bonded amount", async () => {
                await expect(
                    bondingManager.transcoder(5, 10)
                ).to.be.revertedWith("transcoder must be registered")
            })

            it("should set transcoder's pending rewardCut and feeShare", async () => {
                await bondingManager.bond(1000, signers[0].address)
                await bondingManager.transcoder(5, 10)

                const tInfo = await bondingManager.getTranscoder(
                    signers[0].address
                )
                assert.equal(tInfo[1], 5, "wrong rewardCut")
                assert.equal(tInfo[2], 10, "wrong feeShare")
            })

            describe("transcoder pool is not full", () => {
                it("should add new transcoder to the pool", async () => {
                    await bondingManager.bond(1000, signers[0].address)
                    const txRes = bondingManager.transcoder(5, 10)

                    await expect(txRes)
                        .to.emit(bondingManager, "TranscoderUpdate")
                        .withArgs(signers[0].address, 5, 10)

                    assert.equal(
                        await bondingManager.nextRoundTotalActiveStake(),
                        1000,
                        "wrong next total stake"
                    )
                    assert.equal(
                        await bondingManager.getTranscoderPoolSize(),
                        1,
                        "wrong transcoder pool size"
                    )
                    assert.equal(
                        await bondingManager.getFirstTranscoderInPool(),
                        signers[0].address,
                        "wrong first transcoder in pool"
                    )
                    assert.equal(
                        await bondingManager.transcoderTotalStake(
                            signers[0].address
                        ),
                        1000,
                        "wrong transcoder total stake"
                    )
                })

                it("should add multiple additional transcoders to the pool", async () => {
                    await bondingManager.bond(2000, signers[0].address)
                    await bondingManager.transcoder(5, 10)
                    await bondingManager
                        .connect(signers[1])
                        .bond(1000, signers[1].address)
                    await bondingManager.connect(signers[1]).transcoder(5, 10)

                    assert.equal(
                        await bondingManager.nextRoundTotalActiveStake(),
                        3000,
                        "wrong next total stake"
                    )
                    assert.equal(
                        await bondingManager.getTranscoderPoolSize(),
                        2,
                        "wrong transcoder pool size"
                    )
                    assert.equal(
                        await bondingManager.getFirstTranscoderInPool(),
                        signers[0].address,
                        "wrong first transcoder in pool"
                    )
                    assert.equal(
                        await bondingManager.getNextTranscoderInPool(
                            signers[0].address
                        ),
                        signers[1].address,
                        "wrong second transcoder in pool"
                    )
                    assert.equal(
                        await bondingManager.transcoderTotalStake(
                            signers[0].address
                        ),
                        2000,
                        "wrong first transcoder total stake"
                    )
                    assert.equal(
                        await bondingManager.transcoderTotalStake(
                            signers[1].address
                        ),
                        1000,
                        "wrong second transcoder total stake"
                    )
                })
            })

            describe("transcoder pool is full", () => {
                describe("caller has sufficient delegated stake to join pool", () => {
                    it("should evict the transcoder with the least delegated stake and add new transcoder to the pool", async () => {
                        const transcoders = signers.slice(0, 2)
                        const newTranscoder = signers[3]

                        await Promise.all(
                            transcoders.map((account, idx) => {
                                return bondingManager
                                    .connect(account)
                                    .bond(1000 * (idx + 1), account.address)
                                    .then(() => {
                                        return bondingManager
                                            .connect(account)
                                            .transcoder(5, 10)
                                    })
                            })
                        )

                        const nextTotalStake = (
                            await bondingManager.nextRoundTotalActiveStake()
                        ).toNumber()

                        // Caller bonds 6000 which is more than transcoder with least delegated stake
                        await bondingManager
                            .connect(newTranscoder)
                            .bond(6000, newTranscoder.address)
                        const txRes = bondingManager
                            .connect(newTranscoder)
                            .transcoder(5, 10)
                        await expect(txRes)
                            .to.emit(bondingManager, "TranscoderUpdate")
                            .withArgs(newTranscoder.address, 5, 10)
                        await fixture.roundsManager.setMockUint256(
                            functionSig("currentRound()"),
                            currentRound + 1
                        )

                        // Subtract evicted transcoder's delegated stake and add new transcoder's delegated stake
                        const expNextTotalStake = nextTotalStake - 1000 + 6000
                        assert.equal(
                            await bondingManager.nextRoundTotalActiveStake(),
                            expNextTotalStake,
                            "wrong next total stake"
                        )

                        assert.isTrue(
                            await bondingManager.isActiveTranscoder(
                                newTranscoder.address
                            ),
                            "caller should be active as transocder"
                        )
                        assert.equal(
                            await bondingManager.getTranscoderPoolSize(),
                            2,
                            "wrong transcoder pool size"
                        )
                        assert.equal(
                            await bondingManager.transcoderTotalStake(
                                newTranscoder.address
                            ),
                            6000,
                            "wrong transcoder total stake"
                        )
                        assert.isFalse(
                            await bondingManager.isActiveTranscoder(
                                signers[0].address
                            ),
                            "transcoder with least delegated stake should be evicted"
                        )
                    })
                })

                describe("caller has insufficient delegated stake to join pool", () => {
                    it("should not add caller with less delegated stake than transcoder with least delegated stake in pool", async () => {
                        const transcoders = signers.slice(0, 5)
                        const newTranscoder = signers[5]

                        await Promise.all(
                            transcoders.map(account => {
                                return bondingManager
                                    .connect(account)
                                    .bond(2000, account.address)
                                    .then(() => {
                                        return bondingManager
                                            .connect(account)
                                            .transcoder(5, 10)
                                    })
                            })
                        )

                        // Caller bonds 600 - less than transcoder with least delegated stake
                        await bondingManager
                            .connect(newTranscoder)
                            .bond(600, newTranscoder.address)
                        await bondingManager
                            .connect(newTranscoder)
                            .transcoder(5, 10)
                        const txRes = bondingManager
                            .connect(newTranscoder)
                            .transcoder(5, 10)
                        await expect(txRes)
                            .to.emit(bondingManager, "TranscoderUpdate")
                            .withArgs(newTranscoder.address, 5, 10)
                        await fixture.roundsManager.setMockUint256(
                            functionSig("currentRound()"),
                            currentRound + 1
                        )

                        assert.isFalse(
                            await bondingManager.isActiveTranscoder(
                                newTranscoder.address
                            ),
                            "should not register caller as a transcoder in the pool"
                        )
                    })

                    it("should not add caller with equal delegated stake to transcoder with least delegated stake in pool", async () => {
                        const transcoders = signers.slice(0, 5)
                        const newTranscoder = signers[5]

                        await Promise.all(
                            transcoders.map(account => {
                                return bondingManager
                                    .connect(account)
                                    .bond(2000, account.address)
                                    .then(() => {
                                        return bondingManager
                                            .connect(account)
                                            .transcoder(5, 10)
                                    })
                            })
                        )

                        // Caller bonds 2000 - same as transcoder with least delegated stake
                        await bondingManager
                            .connect(newTranscoder)
                            .bond(2000, newTranscoder.address)
                        const txRes = bondingManager
                            .connect(newTranscoder)
                            .transcoder(5, 10)
                        await expect(txRes)
                            .to.emit(bondingManager, "TranscoderUpdate")
                            .withArgs(newTranscoder.address, 5, 10)
                        await fixture.roundsManager.setMockUint256(
                            functionSig("currentRound()"),
                            currentRound + 1
                        )
                        assert.isFalse(
                            await bondingManager.isActiveTranscoder(
                                newTranscoder.address
                            ),
                            "should not register caller as a transcoder in the pool"
                        )
                    })
                })
            })
        })

        describe("transcoder is already registered", () => {
            it("should update transcoder's pending rewardCut and feeShare", async () => {
                await bondingManager.bond(1000, signers[0].address)
                await bondingManager.transcoder(5, 10)

                let tInfo = await bondingManager.getTranscoder(
                    signers[0].address
                )
                assert.equal(tInfo[1], 5, "wrong rewardCut")
                assert.equal(tInfo[2], 10, "wrong feeShare")

                await bondingManager.transcoder(10, 15)

                tInfo = await bondingManager.getTranscoder(signers[0].address)
                assert.equal(tInfo[1], 10, "wrong rewardCut")
                assert.equal(tInfo[2], 15, "wrong feeShare")
            })
        })

        describe("transcoder is active", () => {
            beforeEach(async () => {
                await bondingManager.bond(1000, signers[0].address)
                await bondingManager.transcoder(5, 10)
                await fixture.roundsManager.setMockUint256(
                    functionSig("currentRound()"),
                    currentRound + 1
                )
            })

            it("fails if transcoder has not called reward for the current round", async () => {
                await expect(
                    bondingManager.transcoder(10, 20)
                ).to.be.revertedWith(
                    "caller can't be active or must have already called reward for the current round"
                )
            })

            it("sets rewardCut and feeShare if transcoder has already called reward in the current round", async () => {
                await bondingManager.reward()
                await bondingManager.transcoder(10, 20)
                const transcoder = await bondingManager.getTranscoder(
                    signers[0].address
                )
                assert.equal(transcoder.rewardCut, 10, "wrong rewardCut")
                assert.equal(transcoder.feeShare, 20, "wrong feeShare")
            })
        })
    })

    describe("bond", () => {
        let transcoder0
        let transcoder1
        let transcoder2
        let nonTranscoder
        let delegator
        let delegator2
        const currentRound = 100

        beforeEach(async () => {
            transcoder0 = signers[0]
            transcoder1 = signers[1]
            transcoder2 = signers[2]
            nonTranscoder = signers[9]
            delegator = signers[3]
            delegator2 = signers[4]

            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                true
            )
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundLocked()"),
                false
            )
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound - 1
            )
            await bondingManager
                .connect(transcoder0)
                .bond(1000, transcoder0.address)
            await bondingManager.connect(transcoder0).transcoder(5, 10)
            await bondingManager
                .connect(transcoder1)
                .bond(2000, transcoder1.address)
            await bondingManager.connect(transcoder1).transcoder(5, 10)
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound
            )
        })

        it("should fail if current round is not initialized", async () => {
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                false
            )

            await expect(
                bondingManager
                    .connect(delegator)
                    .bond(1000, transcoder0.address)
            ).to.be.revertedWith("current round is not initialized")
        })

        describe("update transcoder pool", () => {
            beforeEach(async () => {
                await bondingManager
                    .connect(transcoder2)
                    .bond(500, transcoder2.address)
                await bondingManager.connect(transcoder2).transcoder(5, 10)
                await fixture.roundsManager.setMockUint256(
                    functionSig("currentRound()"),
                    currentRound + 1
                )
                await fixture.roundsManager.execute(
                    bondingManager.address,
                    functionSig("setCurrentRoundTotalActiveStake()")
                )
            })

            it("adds a new transcoder to the pool", async () => {
                await bondingManager
                    .connect(transcoder2)
                    .bond(1000, transcoder2.address)
                const firstTranscoder =
                    await bondingManager.getFirstTranscoderInPool()
                const firstStake = await bondingManager.transcoderTotalStake(
                    firstTranscoder
                )
                const secondTranscoder =
                    await bondingManager.getNextTranscoderInPool(
                        firstTranscoder
                    )
                const secondStake = await bondingManager.transcoderTotalStake(
                    secondTranscoder
                )
                const firstDel = await bondingManager.getDelegator(
                    firstTranscoder
                )
                const secondDel = await bondingManager.getDelegator(
                    secondTranscoder
                )
                assert.equal(firstTranscoder, transcoder1.address)
                assert.equal(
                    firstStake.toString(),
                    firstDel.delegatedAmount.toString()
                )
                assert.equal(secondTranscoder, transcoder2.address)
                assert.equal(
                    secondStake.toString(),
                    secondDel.delegatedAmount.toString()
                )
            })

            it("should update current earningsPool totalStake when lastActiveStakeUpdateRound < currentRound", async () => {
                const lastActiveStakeUpdateRound = (
                    await bondingManager.getTranscoder(transcoder0.address)
                ).lastActiveStakeUpdateRound
                assert.isBelow(
                    lastActiveStakeUpdateRound.toNumber(),
                    currentRound + 1
                )

                await bondingManager
                    .connect(delegator)
                    .bond(1000, transcoder0.address)

                const lastActiveStake = (
                    await bondingManager.getTranscoderEarningsPoolForRound(
                        transcoder0.address,
                        lastActiveStakeUpdateRound
                    )
                ).totalStake
                const pool =
                    await bondingManager.getTranscoderEarningsPoolForRound(
                        transcoder0.address,
                        currentRound + 1
                    )
                assert.equal(
                    pool.totalStake.toString(),
                    lastActiveStake.toString()
                )
            })

            it("should not update current earningsPool totalStake when lastActiveStakeUpdateRound = currentRound", async () => {
                await bondingManager
                    .connect(delegator)
                    .bond(500, transcoder0.address)
                await fixture.roundsManager.setMockUint256(
                    functionSig("currentRound()"),
                    currentRound + 2
                )
                const lastActiveStakeUpdateRound = (
                    await bondingManager.getTranscoder(transcoder0.address)
                ).lastActiveStakeUpdateRound
                assert.equal(
                    lastActiveStakeUpdateRound.toNumber(),
                    currentRound + 2
                )

                const startActiveStake = (
                    await bondingManager.getTranscoderEarningsPoolForRound(
                        transcoder0.address,
                        currentRound + 2
                    )
                ).totalStake
                await bondingManager
                    .connect(delegator)
                    .bond(1000, transcoder0.address)
                const endActiveStake = (
                    await bondingManager.getTranscoderEarningsPoolForRound(
                        transcoder0.address,
                        currentRound + 2
                    )
                ).totalStake

                assert.equal(
                    startActiveStake.toString(),
                    endActiveStake.toString()
                )
            })

            it("should not update current earningsPool totalStake when lastActiveStakeUpdateRound > currentRound", async () => {
                await bondingManager
                    .connect(delegator)
                    .bond(500, transcoder0.address)
                const lastActiveStakeUpdateRound = (
                    await bondingManager.getTranscoder(transcoder0.address)
                ).lastActiveStakeUpdateRound
                assert.isAbove(
                    lastActiveStakeUpdateRound.toNumber(),
                    currentRound + 1
                )

                const startActiveStake = (
                    await bondingManager.getTranscoderEarningsPoolForRound(
                        transcoder0.address,
                        currentRound + 1
                    )
                ).totalStake
                await bondingManager
                    .connect(delegator)
                    .bond(500, transcoder0.address)
                const endActiveStake = (
                    await bondingManager.getTranscoderEarningsPoolForRound(
                        transcoder0.address,
                        currentRound + 1
                    )
                ).totalStake

                assert.equal(
                    startActiveStake.toString(),
                    endActiveStake.toString()
                )
            })

            describe("evicts a transcoder from the pool", () => {
                it("last transcoder gets evicted and new transcoder gets inserted", async () => {
                    const txRes = bondingManager
                        .connect(delegator)
                        .bond(2000, transcoder2.address)
                    await expect(txRes)
                        .to.emit(bondingManager, "TranscoderDeactivated")
                        .withArgs(transcoder0.address, currentRound + 2)
                    await fixture.roundsManager.setMockUint256(
                        functionSig("currentRound()"),
                        currentRound + 2
                    )
                    assert.isTrue(
                        await bondingManager.isActiveTranscoder(
                            transcoder2.address
                        )
                    )
                    assert.isTrue(
                        await bondingManager.isActiveTranscoder(
                            transcoder1.address
                        )
                    )
                    assert.isFalse(
                        await bondingManager.isActiveTranscoder(
                            transcoder0.address
                        )
                    )
                    assert.equal(
                        (
                            await bondingManager.transcoderTotalStake(
                                transcoder2.address
                            )
                        ).toString(),
                        "2500"
                    )
                })

                it("sets deactivationRound for the inserted transcoder to the max possible round number", async () => {
                    await bondingManager
                        .connect(delegator)
                        .bond(2000, transcoder2.address)
                    assert.equal(
                        (
                            await bondingManager.getTranscoder(
                                transcoder2.address
                            )
                        ).deactivationRound,
                        2 ** 256 - 1
                    )
                })

                it("sets the deactivationRound for the evicted transcoder to the next round", async () => {
                    await bondingManager
                        .connect(delegator)
                        .bond(2000, transcoder2.address)
                    assert.equal(
                        (
                            await bondingManager.getTranscoder(
                                transcoder0.address
                            )
                        ).deactivationRound,
                        currentRound + 2
                    )
                })

                it("fires a TranscoderActivated event for the new transcoder", async () => {
                    const txRes = bondingManager
                        .connect(delegator)
                        .bond(2000, transcoder2.address)
                    await expect(txRes)
                        .to.emit(bondingManager, "TranscoderActivated")
                        .withArgs(transcoder2.address, currentRound + 2)
                })
            })

            it("inserts into pool without evicting if pool is not full", async () => {
                await bondingManager.connect(transcoder1).unbond(2000)
                await bondingManager
                    .connect(delegator)
                    .bond(2500, transcoder2.address)
                await fixture.roundsManager.setMockUint256(
                    functionSig("currentRound()"),
                    currentRound + 2
                )
                assert.isTrue(
                    await bondingManager.isActiveTranscoder(transcoder2.address)
                )
                assert.isTrue(
                    await bondingManager.isActiveTranscoder(transcoder0.address)
                )
                // transcoder 2 should be first
                assert.equal(
                    await bondingManager.getFirstTranscoderInPool(),
                    transcoder2.address
                )
            })

            it("doesn't insert into pool when stake is too low", async () => {
                await bondingManager
                    .connect(delegator)
                    .bond(10, transcoder2.address)
                await fixture.roundsManager.setMockUint256(
                    functionSig("currentRound()"),
                    currentRound + 2
                )
                assert.isFalse(
                    await bondingManager.isActiveTranscoder(transcoder2.address)
                )
            })

            it("updates total stake in earnings pool for next round", async () => {
                await bondingManager
                    .connect(delegator)
                    .bond(2000, transcoder2.address)
                const poolT2 =
                    await bondingManager.getTranscoderEarningsPoolForRound(
                        transcoder2.address,
                        currentRound + 2
                    )
                assert.equal(poolT2.totalStake, 2500)
            })
        })

        describe("caller is unbonded", () => {
            it("should fail if provided amount = 0", async () => {
                await expect(
                    bondingManager
                        .connect(delegator)
                        .bond(0, transcoder0.address)
                ).to.be.revertedWith("delegation amount must be greater than 0")
            })

            it("should set startRound to the next round", async () => {
                await bondingManager
                    .connect(delegator)
                    .bond(1000, transcoder0.address)

                const dInfo = await bondingManager.getDelegator(
                    delegator.address
                )
                assert.equal(dInfo[4], currentRound + 1, "wrong startRound")
            })

            it("should set delegate", async () => {
                await bondingManager
                    .connect(delegator)
                    .bond(1000, transcoder0.address)

                assert.equal(
                    (await bondingManager.getDelegator(delegator.address))[2],
                    transcoder0.address,
                    "wrong delegateAddress"
                )
            })

            it("should update delegate and bonded amount", async () => {
                const startDelegatedAmount = (
                    await bondingManager.getDelegator(transcoder0.address)
                )[3]
                await bondingManager
                    .connect(delegator)
                    .bond(1000, transcoder0.address)
                const endDelegatedAmount = (
                    await bondingManager.getDelegator(transcoder0.address)
                )[3]

                assert.equal(
                    endDelegatedAmount.sub(startDelegatedAmount),
                    1000,
                    "wrong change in delegatedAmount"
                )
                assert.equal(
                    (await bondingManager.getDelegator(delegator.address))[0],
                    1000,
                    "wrong bondedAmount"
                )
            })

            it("should allow delegate to be null", async () => {
                const startDelegatedAmount = (
                    await bondingManager.getDelegator(ZERO_ADDRESS)
                ).delegatedAmount

                await bondingManager.connect(delegator).bond(1000, ZERO_ADDRESS)

                const endDelegatedAmount = (
                    await bondingManager.getDelegator(ZERO_ADDRESS)
                ).delegatedAmount

                expect(endDelegatedAmount.sub(startDelegatedAmount)).to.equal(
                    1000
                )

                const info = await bondingManager.getDelegator(
                    delegator.address
                )
                expect(info.delegateAddress).to.equal(ZERO_ADDRESS)
                expect(info.bondedAmount).to.equal(1000)
            })

            it("should fire a Bond event when bonding from unbonded", async () => {
                const txRes = bondingManager
                    .connect(delegator)
                    .bond(1000, transcoder0.address)
                await expect(txRes)
                    .to.emit(bondingManager, "Bond")
                    .withArgs(
                        transcoder0.address,
                        constants.NULL_ADDRESS,
                        delegator.address,
                        1000,
                        1000
                    )
            })

            it("fires an EarningsClaimed event when bonding from unbonded", async () => {
                const txResult = bondingManager
                    .connect(delegator)
                    .bond(1000, transcoder0.address)

                await expect(txResult)
                    .to.emit(bondingManager, "EarningsClaimed")
                    .withArgs(
                        constants.NULL_ADDRESS,
                        delegator.address,
                        0,
                        0,
                        1,
                        currentRound
                    )
            })

            it("it doesn't fire an EarningsClaimed event when bonding twice in the same round", async () => {
                await bondingManager
                    .connect(delegator)
                    .bond(1000, transcoder0.address)
                const txResult = bondingManager
                    .connect(delegator)
                    .bond(1000, transcoder0.address)

                await expect(txResult)
                    .to.not.emit(bondingManager, "EarningsClaimed")
                    .withArgs(delegator.address)
            })

            describe("delegate is a registered transcoder", () => {
                it("should increase transcoder's delegated stake in pool", async () => {
                    const startNextTotalStake =
                        await bondingManager.nextRoundTotalActiveStake()
                    const startTranscoderTotalStake =
                        await bondingManager.transcoderTotalStake(
                            transcoder0.address
                        )
                    await bondingManager
                        .connect(delegator)
                        .bond(1000, transcoder0.address)
                    const endNextTotalStake =
                        await bondingManager.nextRoundTotalActiveStake()
                    const endTranscoderTotalStake =
                        await bondingManager.transcoderTotalStake(
                            transcoder0.address
                        )

                    assert.equal(
                        endNextTotalStake.sub(startNextTotalStake),
                        1000,
                        "wrong change in next total stake"
                    )
                    assert.equal(
                        endTranscoderTotalStake.sub(startTranscoderTotalStake),
                        1000,
                        "wrong change in transcoder total stake"
                    )
                })
                it("should update delegate's position in transcoder pool", async () => {
                    await bondingManager
                        .connect(delegator)
                        .bond(3000, transcoder0.address)
                    assert.equal(
                        await bondingManager.getFirstTranscoderInPool(),
                        transcoder0.address,
                        "did not correctly update position in transcoder pool"
                    )
                })
                it("should increase the total stake for the next round", async () => {
                    const startTotalStake =
                        await bondingManager.nextRoundTotalActiveStake()
                    await bondingManager
                        .connect(delegator)
                        .bond(3000, transcoder0.address)
                    const endTotalStake =
                        await bondingManager.nextRoundTotalActiveStake()
                    assert.equal(endTotalStake.sub(startTotalStake), 3000)
                })
                it("should update transcoder's lastActiveStakeUpdateRound", async () => {
                    await bondingManager
                        .connect(delegator)
                        .bond(3000, transcoder0.address)
                    assert.equal(
                        (
                            await bondingManager.getTranscoder(
                                transcoder0.address
                            )
                        ).lastActiveStakeUpdateRound,
                        currentRound + 1
                    )
                })
            })
            describe("delegate is not a registered transcoder", () => {
                it("should not update next total stake", async () => {
                    const startNextTotalStake =
                        await bondingManager.nextRoundTotalActiveStake()
                    await bondingManager
                        .connect(delegator)
                        .bond(1000, nonTranscoder.address)
                    const endNextTotalStake =
                        await bondingManager.nextRoundTotalActiveStake()
                    assert.equal(
                        endNextTotalStake.sub(startNextTotalStake),
                        0,
                        "wrong change in next total stake"
                    )
                })
                it("should not update total active stake for the next round", async () => {
                    const startTotalStake =
                        await bondingManager.nextRoundTotalActiveStake()
                    await bondingManager
                        .connect(delegator)
                        .bond(1000, nonTranscoder.address)
                    const endTotalStake =
                        await bondingManager.nextRoundTotalActiveStake()
                    assert.equal(
                        startTotalStake.sub(endTotalStake),
                        0,
                        "wrong change in total active stake for next round"
                    )
                })
                it("should not update transcoder's lastActiveStakeUpdateRound", async () => {
                    await bondingManager
                        .connect(delegator)
                        .bond(3000, nonTranscoder.address)
                    assert.equal(
                        (
                            await bondingManager.getTranscoder(
                                nonTranscoder.address
                            )
                        ).lastActiveStakeUpdateRound,
                        0
                    )
                })
            })
        })
        describe("caller is bonded", () => {
            beforeEach(async () => {
                await bondingManager
                    .connect(delegator)
                    .bond(2000, transcoder0.address)
            })

            describe("caller is changing delegate", () => {
                it("should fail if caller is a registered transcoder", async () => {
                    await fixture.roundsManager.setMockUint256(
                        functionSig("currentRound()"),
                        currentRound + 1
                    )
                    await expect(
                        bondingManager
                            .connect(transcoder0)
                            .bond(0, transcoder1.address)
                    ).to.be.revertedWith(
                        "registered transcoders can't delegate towards other addresses"
                    )
                })
                it("should set startRound to next round", async () => {
                    await bondingManager
                        .connect(delegator)
                        .bond(0, transcoder1.address)
                    assert.equal(
                        (
                            await bondingManager.getDelegator(delegator.address)
                        )[4],
                        currentRound + 1,
                        "wrong startRound"
                    )
                })
                it("should decrease old delegate's delegated amount", async () => {
                    const startDelegatedAmount = (
                        await bondingManager.getDelegator(transcoder0.address)
                    )[3]
                    await bondingManager
                        .connect(delegator)
                        .bond(0, transcoder1.address)
                    const endDelegatedAmount = (
                        await bondingManager.getDelegator(transcoder0.address)
                    )[3]
                    assert.equal(
                        startDelegatedAmount.sub(endDelegatedAmount),
                        2000,
                        "wrong change in delegatedAmount"
                    )
                })
                it("should decrease old delegate's delegated amount if current delegate is null", async () => {
                    await bondingManager
                        .connect(delegator)
                        .bond(0, ZERO_ADDRESS)

                    const startDelegatedAmount = (
                        await bondingManager.getDelegator(ZERO_ADDRESS)
                    ).delegatedAmount

                    await bondingManager
                        .connect(delegator)
                        .bond(0, transcoder1.address)

                    const endDelegatedAmount = (
                        await bondingManager.getDelegator(ZERO_ADDRESS)
                    ).delegatedAmount

                    expect(
                        startDelegatedAmount.sub(endDelegatedAmount)
                    ).to.equal(2000)
                })
                it("should set new delegate", async () => {
                    await bondingManager
                        .connect(delegator)
                        .bond(0, transcoder1.address)
                    assert.equal(
                        (
                            await bondingManager.getDelegator(delegator.address)
                        )[2],
                        transcoder1.address,
                        "wrong delegateAddress"
                    )
                })
                describe("old delegate is registered transcoder", () => {
                    describe("new delegate is a registered transcoder", () => {
                        it("should update new delegate's position in transcoder pool", async () => {
                            await bondingManager
                                .connect(delegator)
                                .bond(0, transcoder1.address)
                            await fixture.roundsManager.setMockUint256(
                                functionSig("currentRound()"),
                                currentRound + 1
                            )
                            // New delegate was not previously first transcoder in pool and now is
                            assert.equal(
                                await bondingManager.getFirstTranscoderInPool(),
                                transcoder1.address,
                                "did not correctly update position in pool"
                            )
                        })
                        it("should not increase/decrease the total active stake for the next round", async () => {
                            const startTotalStake =
                                await bondingManager.nextRoundTotalActiveStake()
                            await bondingManager
                                .connect(delegator)
                                .bond(0, transcoder1.address)
                            const endTotalStake =
                                await bondingManager.nextRoundTotalActiveStake()
                            assert.equal(
                                startTotalStake.sub(endTotalStake),
                                0,
                                "wrong change in total active stake for next round"
                            )
                        })
                        it("should update old delegate and new delegate's lastActiveStakeUpdateRound", async () => {
                            await bondingManager
                                .connect(delegator)
                                .bond(0, transcoder1.address)
                            assert.equal(
                                (
                                    await bondingManager.getTranscoder(
                                        transcoder0.address
                                    )
                                ).lastActiveStakeUpdateRound,
                                currentRound + 1
                            )
                            assert.equal(
                                (
                                    await bondingManager.getTranscoder(
                                        transcoder1.address
                                    )
                                ).lastActiveStakeUpdateRound,
                                currentRound + 1
                            )
                        })
                    })
                    describe("new delegate is not a registered transcoder", () => {
                        it("should not update new delegate's position in transcoder pool", async () => {
                            await bondingManager
                                .connect(delegator)
                                .bond(0, nonTranscoder.address)
                            await fixture.roundsManager.setMockUint256(
                                functionSig("currentRound()"),
                                currentRound + 1
                            )
                            assert.isFalse(
                                await bondingManager.isActiveTranscoder(
                                    nonTranscoder.address
                                )
                            )
                        })
                        it("should decrease the total active stake for the next round", async () => {
                            const startTotalStake =
                                await bondingManager.nextRoundTotalActiveStake()
                            await bondingManager
                                .connect(delegator)
                                .bond(0, nonTranscoder.address)
                            const endTotalStake =
                                await bondingManager.nextRoundTotalActiveStake()
                            assert.equal(
                                startTotalStake.sub(endTotalStake),
                                2000,
                                "wrong change in total active stake for next round"
                            )
                        })
                        it("should only update old delegate's lastActiveStakeUpdateRound", async () => {
                            await bondingManager
                                .connect(delegator)
                                .bond(0, nonTranscoder.address)
                            assert.equal(
                                (
                                    await bondingManager.getTranscoder(
                                        transcoder0.address
                                    )
                                ).lastActiveStakeUpdateRound,
                                currentRound + 1
                            )
                            assert.equal(
                                (
                                    await bondingManager.getTranscoder(
                                        nonTranscoder.address
                                    )
                                ).lastActiveStakeUpdateRound,
                                0
                            )
                        })
                    })
                })
                describe("old delegate is not a registered transcoder", () => {
                    beforeEach(async () => {
                        await bondingManager
                            .connect(delegator)
                            .bond(0, delegator2.address)
                    })
                    describe("new delegate is a registered transcoder", () => {
                        it("should update new delegate's position in transcoder pool", async () => {
                            await bondingManager
                                .connect(delegator)
                                .bond(0, transcoder0.address)
                            await fixture.roundsManager.setMockUint256(
                                functionSig("currentRound()"),
                                currentRound + 1
                            )
                            // New delegate was not previously first transcoder in pool and now is
                            assert.equal(
                                await bondingManager.getFirstTranscoderInPool(),
                                transcoder0.address,
                                "did not correctly update position in pool"
                            )
                        })
                        it("should increase the total active stake for the next round", async () => {
                            const startTotalStake =
                                await bondingManager.nextRoundTotalActiveStake()
                            await bondingManager
                                .connect(delegator)
                                .bond(0, transcoder1.address)
                            const endTotalStake =
                                await bondingManager.nextRoundTotalActiveStake()
                            assert.equal(
                                endTotalStake.sub(startTotalStake),
                                2000,
                                "wrong change in total active stake for next round"
                            )
                        })
                        it("should only update new delegate lastActiveStakeUpdateRound", async () => {
                            await bondingManager
                                .connect(delegator)
                                .bond(0, transcoder0.address)
                            assert.equal(
                                (
                                    await bondingManager.getTranscoder(
                                        transcoder0.address
                                    )
                                ).lastActiveStakeUpdateRound,
                                currentRound + 1
                            )
                            assert.equal(
                                (
                                    await bondingManager.getTranscoder(
                                        delegator2.address
                                    )
                                ).lastActiveStakeUpdateRound,
                                0
                            )
                        })
                    })
                    describe("new delegate is not a registered transcoder()", () => {
                        it("should not update the new delegate's position in transcoder pool", async () => {
                            await bondingManager
                                .connect(delegator)
                                .bond(0, nonTranscoder.address)
                            await fixture.roundsManager.setMockUint256(
                                functionSig("currentRound()"),
                                currentRound + 1
                            )
                            assert.isFalse(
                                await bondingManager.isActiveTranscoder(
                                    nonTranscoder.address
                                ),
                                "did not correctly update position in pool"
                            )
                        })
                        it("should not update new delegate's lastActiveStakeUpdateRound", async () => {
                            await bondingManager
                                .connect(delegator)
                                .bond(0, nonTranscoder.address)
                            assert.equal(
                                (
                                    await bondingManager.getTranscoder(
                                        nonTranscoder.address
                                    )
                                ).lastActiveStakeUpdateRound,
                                0
                            )
                        })
                    })
                })
                describe("caller is just moving bonded stake because provided amount = 0", () => {
                    it("should update new delegate's delegated amount with current bonded stake", async () => {
                        const startDelegatedAmount = (
                            await bondingManager.getDelegator(
                                transcoder1.address
                            )
                        )[3]
                        await bondingManager
                            .connect(delegator)
                            .bond(0, transcoder1.address)
                        const endDelegatedAmount = (
                            await bondingManager.getDelegator(
                                transcoder1.address
                            )
                        )[3]
                        assert.equal(
                            endDelegatedAmount.sub(startDelegatedAmount),
                            2000,
                            "wrong change in delegatedAmount"
                        )
                    })
                    it("should not update bonded amount", async () => {
                        const startBondedAmount = (
                            await bondingManager.getDelegator(delegator.address)
                        )[0]
                        await bondingManager
                            .connect(delegator)
                            .bond(0, transcoder1.address)
                        const endBondedAmount = (
                            await bondingManager.getDelegator(delegator.address)
                        )[0]
                        assert.equal(
                            endBondedAmount.sub(startBondedAmount),
                            0,
                            "bondedAmount change should be 0"
                        )
                    })
                    it("should fire a Bond event when changing delegates", async () => {
                        const txRes = bondingManager
                            .connect(delegator)
                            .bond(0, transcoder1.address)

                        await expect(txRes)
                            .to.emit(bondingManager, "Bond")
                            .withArgs(
                                transcoder1.address,
                                transcoder0.address,
                                delegator.address,
                                0,
                                2000
                            )
                    })
                    describe("new delegate is registered transcoder", () => {
                        it("should increase transcoder's total stake in pool with current bonded stake", async () => {
                            const startTranscoderTotalStake =
                                await bondingManager.transcoderTotalStake(
                                    transcoder1.address
                                )
                            await bondingManager
                                .connect(delegator)
                                .bond(0, transcoder1.address)
                            const endTranscoderTotalStake =
                                await bondingManager.transcoderTotalStake(
                                    transcoder1.address
                                )
                            assert.equal(
                                endTranscoderTotalStake.sub(
                                    startTranscoderTotalStake
                                ),
                                2000,
                                "wrong change in transcoder total stake"
                            )
                        })
                        describe("old delegate is registered transcoder", () => {
                            it("should not change next total stake", async () => {
                                const startNextTotalStake =
                                    await bondingManager.nextRoundTotalActiveStake()
                                await bondingManager
                                    .connect(delegator)
                                    .bond(0, transcoder1.address)
                                const endNextTotalStake =
                                    await bondingManager.nextRoundTotalActiveStake()
                                assert.equal(
                                    endNextTotalStake.sub(startNextTotalStake),
                                    0,
                                    "wrong change in next total stake"
                                )
                            })
                        })
                        describe("old delegate is not registered transcoder", () => {
                            it("should increase next total stake", async () => {
                                // Delegate to non-transcoder
                                await bondingManager
                                    .connect(delegator)
                                    .bond(0, nonTranscoder.address)
                                const startNextTotalStake =
                                    await bondingManager.nextRoundTotalActiveStake()
                                await bondingManager
                                    .connect(delegator)
                                    .bond(0, transcoder1.address)
                                const endNextTotalStake =
                                    await bondingManager.nextRoundTotalActiveStake()
                                assert.equal(
                                    endNextTotalStake.sub(startNextTotalStake),
                                    2000,
                                    "wrong change in next total stake"
                                )
                            })
                        })
                    })
                    describe("new delegate is not registered transcoder", () => {
                        describe("old delegate is registered transcoder", () => {
                            it("should decrease next total stake", async () => {
                                const startNextTotalStake =
                                    await bondingManager.nextRoundTotalActiveStake()
                                await bondingManager
                                    .connect(delegator)
                                    .bond(0, nonTranscoder.address)
                                const endNextTotalStake =
                                    await bondingManager.nextRoundTotalActiveStake()
                                assert.equal(
                                    startNextTotalStake.sub(endNextTotalStake),
                                    2000,
                                    "wrong change in next total stake"
                                )
                            })
                        })
                        describe("old delegate is not registered transcoder", () => {
                            it("should not change next total stake", async () => {
                                // Delegate to non-transcoder
                                await bondingManager
                                    .connect(delegator)
                                    .bond(0, nonTranscoder.address)
                                const startNextTotalStake =
                                    await bondingManager.nextRoundTotalActiveStake()
                                await bondingManager
                                    .connect(delegator)
                                    .bond(0, delegator2.address)
                                const endNextTotalStake =
                                    await bondingManager.nextRoundTotalActiveStake()
                                assert.equal(
                                    endNextTotalStake.sub(startNextTotalStake),
                                    0,
                                    "wrong change in next total stake"
                                )
                            })
                        })
                    })
                    describe("old delegate is registered transcoder", () => {
                        it("should decrease transcoder's total stake in pool by current bonded stake", async () => {
                            const startTranscoderTotalStake =
                                await bondingManager.transcoderTotalStake(
                                    transcoder0.address
                                )
                            await bondingManager
                                .connect(delegator)
                                .bond(0, transcoder1.address)
                            const endTranscoderTotalStake =
                                await bondingManager.transcoderTotalStake(
                                    transcoder0.address
                                )
                            assert.equal(
                                startTranscoderTotalStake.sub(
                                    endTranscoderTotalStake
                                ),
                                2000,
                                "wrong change in transcoder total stake"
                            )
                        })
                    })
                })
                describe("caller is increasing and moving bonded stake because provided amount > 0", () => {
                    it("should update new delegate's delegated amount with current bonded stake + provided amount", async () => {
                        const startDelegatedAmount = (
                            await bondingManager.getDelegator(
                                transcoder1.address
                            )
                        )[3]
                        await bondingManager
                            .connect(delegator)
                            .bond(1000, transcoder1.address)
                        const endDelegatedAmount = (
                            await bondingManager.getDelegator(
                                transcoder1.address
                            )
                        )[3]
                        assert.equal(
                            endDelegatedAmount.sub(startDelegatedAmount),
                            3000,
                            "wrong change in delegatedAmount"
                        )
                    })
                    it("should update bonded amount", async () => {
                        const startBondedAmount = (
                            await bondingManager.getDelegator(delegator.address)
                        )[0]
                        await bondingManager
                            .connect(delegator)
                            .bond(1000, transcoder1.address)
                        const endBondedAmount = (
                            await bondingManager.getDelegator(delegator.address)
                        )[0]
                        assert.equal(
                            endBondedAmount.sub(startBondedAmount),
                            1000,
                            "wrong change in bondedAmount"
                        )
                    })
                    it("should increase the total stake for the next round", async () => {
                        const startTotalStake =
                            await bondingManager.nextRoundTotalActiveStake()
                        await bondingManager
                            .connect(delegator)
                            .bond(1000, transcoder1.address)
                        const endTotalStake =
                            await bondingManager.nextRoundTotalActiveStake()
                        assert.equal(
                            endTotalStake.sub(startTotalStake),
                            1000,
                            "wrong change in total next round stake"
                        )
                    })
                    it("should fire a Bond event when increasing bonded stake and changing delegates", async () => {
                        const txRes = bondingManager
                            .connect(delegator)
                            .bond(1000, transcoder1.address)

                        await expect(txRes)
                            .to.emit(bondingManager, "Bond")
                            .withArgs(
                                transcoder1.address,
                                transcoder0.address,
                                delegator.address,
                                1000,
                                3000
                            )
                    })
                    describe("new delegate is registered transcoder", () => {
                        it("should increase transcoder's total stake in pool with current bonded stake + provided amount", async () => {
                            const startTranscoderTotalStake =
                                await bondingManager.transcoderTotalStake(
                                    transcoder1.address
                                )
                            await bondingManager
                                .connect(delegator)
                                .bond(1000, transcoder1.address)
                            const endTranscoderTotalStake =
                                await bondingManager.transcoderTotalStake(
                                    transcoder1.address
                                )
                            assert.equal(
                                endTranscoderTotalStake.sub(
                                    startTranscoderTotalStake
                                ),
                                3000,
                                "wrong change in transcoder total stake"
                            )
                        })
                        describe("old delegate is registered transcoder", () => {
                            it("should only increase next total stake by additional bonded stake", async () => {
                                const startNextTotalStake =
                                    await bondingManager.nextRoundTotalActiveStake()
                                await bondingManager
                                    .connect(delegator)
                                    .bond(1000, transcoder1.address)
                                const endNextTotalStake =
                                    await bondingManager.nextRoundTotalActiveStake()
                                assert.equal(
                                    endNextTotalStake.sub(startNextTotalStake),
                                    1000,
                                    "wrong change in next total stake"
                                )
                            })
                        })
                        describe("old delegate is not registered transcoder", () => {
                            it("should increase next total stake by current bonded stake + additional bonded stake", async () => {
                                // Delegate to non-transcoder
                                await bondingManager
                                    .connect(delegator)
                                    .bond(0, nonTranscoder.address)
                                const bondedAmount = (
                                    await bondingManager.getDelegator(
                                        delegator.address
                                    )
                                )[0].toNumber()
                                const startNextTotalStake =
                                    await bondingManager.nextRoundTotalActiveStake()
                                await bondingManager
                                    .connect(delegator)
                                    .bond(1000, transcoder1.address)
                                const endNextTotalStake =
                                    await bondingManager.nextRoundTotalActiveStake()
                                assert.equal(
                                    endNextTotalStake.sub(startNextTotalStake),
                                    bondedAmount + 1000,
                                    "wrong change in next total stake"
                                )
                            })
                        })
                    })
                    describe("new delegate is not registered transcoder", () => {
                        describe("old delegate is registered transcoder", () => {
                            it("should decrease next total stake by current bonded stake (no additional bonded stake counted)", async () => {
                                const bondedAmount = (
                                    await bondingManager.getDelegator(
                                        delegator.address
                                    )
                                )[0].toNumber()
                                const startNextTotalStake =
                                    await bondingManager.nextRoundTotalActiveStake()
                                await bondingManager
                                    .connect(delegator)
                                    .bond(1000, nonTranscoder.address)
                                const endNextTotalStake =
                                    await bondingManager.nextRoundTotalActiveStake()
                                assert.equal(
                                    startNextTotalStake.sub(endNextTotalStake),
                                    bondedAmount,
                                    "wrong change in next total stake"
                                )
                            })
                        })
                        describe("old delegate is not registered transcoder", () => {
                            beforeEach(async () => {
                                // Delegate to non-transcoder
                                await bondingManager
                                    .connect(delegator)
                                    .bond(0, nonTranscoder.address)
                            })
                            it("should not decrease the total stake for the next round", async () => {
                                const startTotalStake =
                                    await bondingManager.nextRoundTotalActiveStake()
                                await bondingManager
                                    .connect(delegator)
                                    .bond(1000, nonTranscoder.address)
                                const endTotalStake =
                                    await bondingManager.nextRoundTotalActiveStake()
                                assert.equal(
                                    endTotalStake
                                        .sub(startTotalStake)
                                        .toString(),
                                    0,
                                    "wrong change in total next round stake"
                                )
                            })
                        })
                    })
                    describe("old delegate is registered transcoder", () => {
                        it("should decrease transcoder's total stake in pool by current bonded stake", async () => {
                            const startTranscoderTotalStake =
                                await bondingManager.transcoderTotalStake(
                                    transcoder0.address
                                )
                            await bondingManager
                                .connect(delegator)
                                .bond(1000, transcoder1.address)
                            const endTranscoderTotalStake =
                                await bondingManager.transcoderTotalStake(
                                    transcoder0.address
                                )
                            assert.equal(
                                startTranscoderTotalStake.sub(
                                    endTranscoderTotalStake
                                ),
                                2000,
                                "wrong change in transcoder total stake"
                            )
                        })
                    })
                })
            })
            describe("caller is increasing bonded amount", () => {
                it("should fail if provided amount = 0", async () => {
                    await expect(
                        bondingManager
                            .connect(delegator)
                            .bond(0, transcoder0.address)
                    ).to.be.revertedWith(
                        "delegation amount must be greater than 0"
                    )
                })
                it("should update bonded amount", async () => {
                    const startBondedAmount = (
                        await bondingManager.getDelegator(delegator.address)
                    )[0]
                    await bondingManager
                        .connect(delegator)
                        .bond(1000, transcoder0.address)
                    const endBondedAmount = (
                        await bondingManager.getDelegator(delegator.address)
                    )[0]
                    assert.equal(
                        endBondedAmount.sub(startBondedAmount),
                        1000,
                        "wrong change in bondedAmount"
                    )
                })
                describe("delegate is registered transcoder", () => {
                    it("should increase the total stake for the next round", async () => {
                        const startTotalStake =
                            await bondingManager.nextRoundTotalActiveStake()
                        await bondingManager
                            .connect(delegator)
                            .bond(1000, transcoder0.address)
                        const endTotalStake =
                            await bondingManager.nextRoundTotalActiveStake()
                        assert.equal(
                            endTotalStake.sub(startTotalStake),
                            1000,
                            "wrong change in nextRoundTotalActiveStake"
                        )
                    })
                })
                describe("delegate is not registered transcoder", () => {
                    beforeEach(async () => {
                        // Delegate to a non-transcoder i.e. self
                        await bondingManager
                            .connect(delegator)
                            .bond(0, nonTranscoder.address)
                    })
                    it("should not change the total active stake for next round", async () => {
                        const startTotalActiveStake =
                            await bondingManager.nextRoundTotalActiveStake()
                        await bondingManager
                            .connect(delegator)
                            .bond(1000, nonTranscoder.address)
                        const endTotalActiveStake =
                            await bondingManager.nextRoundTotalActiveStake()
                        assert.equal(
                            endTotalActiveStake.sub(startTotalActiveStake),
                            0,
                            "wrong change in nextRoundTotalActiveStake"
                        )
                    })
                })
                it("should fire a Bond event when increasing bonded amount", async () => {
                    const txRes = bondingManager
                        .connect(delegator)
                        .bond(1000, transcoder0.address)
                    await expect(txRes)
                        .to.emit(bondingManager, "Bond")
                        .withArgs(
                            transcoder0.address,
                            transcoder0.address,
                            delegator.address,
                            1000,
                            3000
                        )
                })
            })
        })
        describe("set delegate earnings pool factors if not initialized", () => {
            it("sets cumulativeRewardFactor if value is zero", async () => {
                await bondingManager
                    .connect(delegator)
                    .bond(100, transcoder0.address)
                await bondingManager.connect(transcoder1).reward()
                const ep0 =
                    await bondingManager.getTranscoderEarningsPoolForRound(
                        transcoder1.address,
                        currentRound
                    )
                await fixture.roundsManager.setMockUint256(
                    functionSig("currentRound()"),
                    currentRound + 1
                )
                await bondingManager
                    .connect(delegator)
                    .bond(100, transcoder1.address)
                const ep1 =
                    await bondingManager.getTranscoderEarningsPoolForRound(
                        transcoder1.address,
                        currentRound + 1
                    )
                assert.notEqual(ep0.cumulativeRewardFactor.toString(), "0")
                assert.equal(
                    ep0.cumulativeRewardFactor.toString(),
                    ep1.cumulativeRewardFactor.toString()
                )
            })
            it("sets cumulativeFeeFactor if value is zero", async () => {
                await bondingManager
                    .connect(delegator)
                    .bond(100, transcoder0.address)
                await fixture.ticketBroker.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "updateTranscoderWithFees(address,uint256,uint256)",
                        ["address", "uint256", "uint256"],
                        [
                            transcoder1.address,
                            "1000000000000000000",
                            currentRound
                        ]
                    )
                )
                const ep0 =
                    await bondingManager.getTranscoderEarningsPoolForRound(
                        transcoder1.address,
                        currentRound
                    )
                await fixture.roundsManager.setMockUint256(
                    functionSig("currentRound()"),
                    currentRound + 1
                )
                await bondingManager
                    .connect(delegator)
                    .bond(100, transcoder1.address)
                const ep1 =
                    await bondingManager.getTranscoderEarningsPoolForRound(
                        transcoder1.address,
                        currentRound + 1
                    )
                assert.notEqual(ep0.cumulativeFeeFactor.toString(), "0")
                assert.equal(
                    ep0.cumulativeFeeFactor.toString(),
                    ep1.cumulativeFeeFactor.toString()
                )
            })
        })

        it("should checkpoint the delegator and transcoder states", async () => {
            // make sure trancoder has a non-null `lastRewardRound`
            await bondingManager.connect(transcoder0).reward()

            const tx = await bondingManager
                .connect(delegator)
                .bond(1000, transcoder0.address)

            await expectCheckpoints(
                fixture,
                tx,
                {
                    account: transcoder0.address,
                    startRound: currentRound + 1,
                    bondedAmount: 1000,
                    delegateAddress: transcoder0.address,
                    delegatedAmount: 2000,
                    lastClaimRound: currentRound - 1,
                    lastRewardRound: 100
                },
                {
                    account: delegator.address,
                    startRound: currentRound + 1,
                    bondedAmount: 1000,
                    delegateAddress: transcoder0.address,
                    delegatedAmount: 0,
                    lastClaimRound: currentRound,
                    lastRewardRound: 0
                }
            )
        })
    })

    describe("bondForWithHint", () => {
        let transcoder0
        let transcoder1
        let delegator1
        let delegator2
        let delegator3
        let thirdParty
        let l2migrator
        const currentRound = 100

        beforeEach(async () => {
            transcoder0 = signers[0]
            transcoder1 = signers[1]
            delegator1 = signers[2]
            delegator2 = signers[3]
            delegator3 = signers[4]
            l2migrator = signers[5]
            thirdParty = signers[6]

            await fixture.controller.setContractInfo(
                contractId("L2Migrator"),
                l2migrator.address,
                ethers.utils.randomBytes(20)
            )

            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                true
            )
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundLocked()"),
                false
            )
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound - 1
            )
            await bondingManager
                .connect(transcoder0)
                .bond(1000, transcoder0.address)
            await bondingManager.connect(transcoder0).transcoder(5, 10)
            await bondingManager
                .connect(transcoder1)
                .bond(2000, transcoder1.address)
            await bondingManager.connect(transcoder1).transcoder(5, 10)

            await bondingManager
                .connect(delegator1)
                .bond(2000, transcoder0.address)

            await bondingManager
                .connect(delegator2)
                .bond(2000, transcoder1.address)

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound
            )
        })

        describe("caller is unbonded", () => {
            describe("caller is l2Migrator", () => {
                it("should set delegate for a delegator", async () => {
                    const initialDelegate = (
                        await bondingManager.getDelegator(delegator3.address)
                    ).delegateAddress
                    expect(initialDelegate).to.equal(
                        ethers.constants.AddressZero,
                        "wrong delegateAddress"
                    )

                    await bondingManager
                        .connect(l2migrator)
                        .bondForWithHint(
                            1000,
                            delegator3.address,
                            transcoder0.address,
                            ethers.constants.AddressZero,
                            ethers.constants.AddressZero,
                            ethers.constants.AddressZero,
                            ethers.constants.AddressZero
                        )

                    const delegateAddress = (
                        await bondingManager.getDelegator(delegator3.address)
                    ).delegateAddress
                    expect(delegateAddress).to.equal(
                        transcoder0.address,
                        "wrong delegateAddress"
                    )
                })

                it("should change delegate for a delegator", async () => {
                    const initialDelegate = (
                        await bondingManager.getDelegator(delegator1.address)
                    ).delegateAddress
                    expect(initialDelegate).to.equal(
                        transcoder0.address,
                        "wrong delegateAddress"
                    )

                    await bondingManager
                        .connect(l2migrator)
                        .bondForWithHint(
                            1000,
                            delegator1.address,
                            transcoder1.address,
                            ethers.constants.AddressZero,
                            ethers.constants.AddressZero,
                            ethers.constants.AddressZero,
                            ethers.constants.AddressZero
                        )

                    const delegateAddress = (
                        await bondingManager.getDelegator(delegator1.address)
                    ).delegateAddress
                    expect(delegateAddress).to.equal(
                        transcoder1.address,
                        "wrong delegateAddress"
                    )
                })

                it("should increase delegated amount for a delegator without changing delegate", async () => {
                    const delegate = (
                        await bondingManager.getDelegator(delegator1.address)
                    ).delegateAddress

                    const initialBondedAmount = (
                        await bondingManager.getDelegator(delegator1.address)
                    ).bondedAmount

                    await bondingManager
                        .connect(l2migrator)
                        .bondForWithHint(
                            1000,
                            delegator1.address,
                            delegate,
                            ethers.constants.AddressZero,
                            ethers.constants.AddressZero,
                            ethers.constants.AddressZero,
                            ethers.constants.AddressZero
                        )

                    const endBondedAmount = (
                        await bondingManager.getDelegator(delegator1.address)
                    ).bondedAmount

                    expect(endBondedAmount.sub(initialBondedAmount)).to.equal(
                        1000,
                        "wrong change in bonded amount"
                    )
                })
            })

            describe("caller is third party", () => {
                it("should set delegate to transcoder for an unbonded delegator", async () => {
                    const initialDelegate = (
                        await bondingManager.getDelegator(delegator3.address)
                    ).delegateAddress
                    expect(initialDelegate).to.equal(
                        ethers.constants.AddressZero,
                        "wrong delegateAddress"
                    )

                    await bondingManager
                        .connect(thirdParty)
                        .bondForWithHint(
                            1000,
                            delegator3.address,
                            transcoder0.address,
                            ethers.constants.AddressZero,
                            ethers.constants.AddressZero,
                            ethers.constants.AddressZero,
                            ethers.constants.AddressZero
                        )

                    const finalDelegate = (
                        await bondingManager.getDelegator(delegator3.address)
                    ).delegateAddress
                    expect(finalDelegate).to.equal(
                        transcoder0.address,
                        "wrong delegateAddress"
                    )

                    const bondedAmount = (
                        await bondingManager.getDelegator(delegator3.address)
                    ).bondedAmount

                    expect(bondedAmount).to.equal(1000)
                })

                it("should fail to set delegate to self for an unbonded delegator", async () => {
                    const initialDelegate = (
                        await bondingManager.getDelegator(delegator3.address)
                    ).delegateAddress
                    expect(initialDelegate).to.equal(
                        ethers.constants.AddressZero,
                        "wrong delegateAddress"
                    )

                    const tx = bondingManager
                        .connect(thirdParty)
                        .bondForWithHint(
                            1000,
                            delegator3.address,
                            delegator3.address,
                            ethers.constants.AddressZero,
                            ethers.constants.AddressZero,
                            ethers.constants.AddressZero,
                            ethers.constants.AddressZero
                        )

                    await expect(tx).to.be.revertedWith("INVALID_DELEGATE")
                })

                it("should fail to change delegate for bonded delegator", async () => {
                    const initialDelegate = (
                        await bondingManager.getDelegator(delegator1.address)
                    ).delegateAddress
                    expect(initialDelegate).to.equal(
                        transcoder0.address,
                        "wrong delegateAddress"
                    )

                    const tx = bondingManager
                        .connect(thirdParty)
                        .bondForWithHint(
                            1000,
                            delegator1.address,
                            transcoder1.address,
                            ethers.constants.AddressZero,
                            ethers.constants.AddressZero,
                            ethers.constants.AddressZero,
                            ethers.constants.AddressZero
                        )

                    await expect(tx).to.be.revertedWith(
                        "INVALID_DELEGATE_CHANGE"
                    )
                })

                it("should increase delegated amount for a delegator without changing delegate", async () => {
                    const delegate = (
                        await bondingManager.getDelegator(delegator2.address)
                    ).delegateAddress

                    const startBondedAmount = (
                        await bondingManager.getDelegator(delegator2.address)
                    ).bondedAmount

                    await bondingManager
                        .connect(thirdParty)
                        .bondForWithHint(
                            1000,
                            delegator2.address,
                            delegate,
                            ethers.constants.AddressZero,
                            ethers.constants.AddressZero,
                            ethers.constants.AddressZero,
                            ethers.constants.AddressZero
                        )

                    const endBondedAmount = (
                        await bondingManager.getDelegator(delegator2.address)
                    ).bondedAmount

                    expect(endBondedAmount.sub(startBondedAmount)).to.equal(
                        1000,
                        "wrong change in bonded amount"
                    )
                })
            })
        })

        describe("caller is bonded", () => {
            describe("changing delegate", () => {
                describe("caller is owner", () => {
                    it("should be able to change delegate", async () => {
                        const initialDelegate = (
                            await bondingManager.getDelegator(
                                delegator1.address
                            )
                        ).delegateAddress

                        expect(initialDelegate).to.equal(transcoder0.address)

                        await bondingManager
                            .connect(delegator1)
                            .bondForWithHint(
                                0,
                                delegator1.address,
                                transcoder1.address,
                                ethers.constants.AddressZero,
                                ethers.constants.AddressZero,
                                ethers.constants.AddressZero,
                                ethers.constants.AddressZero
                            )

                        const finalDelegate = (
                            await bondingManager.getDelegator(
                                delegator1.address
                            )
                        ).delegateAddress
                        expect(finalDelegate).to.equal(transcoder1.address)
                    })
                })

                describe("caller is third-party", () => {
                    it("should fail to change delegate for a bonded delegator", async () => {
                        const initialDelegate = (
                            await bondingManager.getDelegator(
                                delegator1.address
                            )
                        ).delegateAddress

                        expect(initialDelegate).to.equal(transcoder0.address)

                        const tx = bondingManager
                            .connect(delegator2)
                            .bondForWithHint(
                                0,
                                delegator1.address,
                                transcoder1.address,
                                ethers.constants.AddressZero,
                                ethers.constants.AddressZero,
                                ethers.constants.AddressZero,
                                ethers.constants.AddressZero
                            )

                        await expect(tx).to.be.revertedWith(
                            "INVALID_DELEGATE_CHANGE"
                        )
                    })

                    it("should fail to change self delegation for a transcoder", async () => {
                        const tx = bondingManager
                            .connect(transcoder1)
                            .bondForWithHint(
                                1000,
                                transcoder0.address,
                                transcoder1.address,
                                ethers.constants.AddressZero,
                                ethers.constants.AddressZero,
                                ethers.constants.AddressZero,
                                ethers.constants.AddressZero
                            )
                        await expect(tx).to.be.revertedWith(
                            "INVALID_DELEGATE_CHANGE"
                        )
                    })
                })

                it("should update the state only for the provided delegator and not for the caller", async () => {
                    const callerDelegatorDataBefore =
                        await bondingManager.getDelegator(thirdParty.address)

                    const delegatorDataBefore =
                        await bondingManager.getDelegator(delegator2.address)

                    await bondingManager
                        .connect(thirdParty)
                        .bondForWithHint(
                            1000,
                            delegator2.address,
                            delegatorDataBefore.delegateAddress,
                            ethers.constants.AddressZero,
                            ethers.constants.AddressZero,
                            ethers.constants.AddressZero,
                            ethers.constants.AddressZero
                        )

                    const callerDelegatorDataAfter =
                        await bondingManager.getDelegator(thirdParty.address)
                    const delegatorDataAfter =
                        await bondingManager.getDelegator(delegator2.address)

                    expect(
                        delegatorDataAfter.bondedAmount.sub(
                            delegatorDataBefore.bondedAmount
                        )
                    ).to.equal(1000, "wrong delegator's bondedAmount")

                    expect(delegatorDataAfter.lastClaimRound).to.equal(
                        delegatorDataBefore.lastClaimRound.add(1),
                        "wrong delegator's lastClaimRound"
                    )

                    expect(callerDelegatorDataAfter).to.matchStruct(
                        callerDelegatorDataBefore,
                        "wrong caller's delegator data"
                    )
                })
            })

            it("should increase stake for receiver without affecting self", async () => {
                const delegate = (
                    await bondingManager.getDelegator(delegator2.address)
                ).delegateAddress

                const startDelegatedAmount = (
                    await bondingManager.getDelegator(delegate)
                ).delegatedAmount

                await bondingManager
                    .connect(delegator1)
                    .bondForWithHint(
                        1000,
                        delegator2.address,
                        delegate,
                        ethers.constants.AddressZero,
                        ethers.constants.AddressZero,
                        ethers.constants.AddressZero,
                        ethers.constants.AddressZero
                    )

                const endDelegatedAmount = (
                    await bondingManager.getDelegator(delegate)
                ).delegatedAmount
                expect(
                    endDelegatedAmount.sub(startDelegatedAmount),
                    1000,
                    "wrong change in delegatedAmount"
                )

                const d1BondedAmount = (
                    await bondingManager.getDelegator(delegator1.address)
                ).bondedAmount
                const d2BondedAmount = (
                    await bondingManager.getDelegator(delegator2.address)
                ).bondedAmount
                expect(d1BondedAmount).to.equal(
                    2000,
                    "wrong bondedAmount for delegator 1"
                )
                expect(d2BondedAmount).to.equal(
                    3000,
                    "wrong bondedAmount for delegator 2"
                )
            })
        })

        it("should checkpoint the delegator and transcoder states", async () => {
            // make sure trancoder has a non-null `lastRewardRound`
            await bondingManager.connect(transcoder0).reward()

            const {bondedAmount: startBondedAmount} =
                await bondingManager.getDelegator(delegator1.address)
            const {
                bondedAmount: selfBondedAmount,
                delegatedAmount: startDelegatedAmount
            } = await bondingManager.getDelegator(transcoder0.address)

            const tx = await bondingManager
                .connect(thirdParty)
                .bondForWithHint(
                    1000,
                    delegator1.address,
                    transcoder0.address,
                    ethers.constants.AddressZero,
                    ethers.constants.AddressZero,
                    ethers.constants.AddressZero,
                    ethers.constants.AddressZero
                )

            await expectCheckpoints(
                fixture,
                tx,
                {
                    account: transcoder0.address,
                    startRound: currentRound + 1,
                    bondedAmount: selfBondedAmount,
                    delegateAddress: transcoder0.address,
                    delegatedAmount: startDelegatedAmount.add(1000),
                    lastClaimRound: currentRound - 1,
                    lastRewardRound: 100
                },
                {
                    account: delegator1.address,
                    startRound: currentRound + 1,
                    bondedAmount: startBondedAmount.add(1000),
                    delegateAddress: transcoder0.address,
                    delegatedAmount: 0,
                    lastClaimRound: currentRound,
                    lastRewardRound: 0
                }
            )
        })
    })

    describe("unbond", () => {
        let transcoder
        let delegator
        let delegator2
        let currentRound

        beforeEach(async () => {
            transcoder = signers[0]
            delegator = signers[1]
            delegator2 = signers[2]
            currentRound = 100

            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                true
            )
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundLocked()"),
                false
            )
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound
            )

            await bondingManager
                .connect(transcoder)
                .bond(1000, transcoder.address)
            await bondingManager.connect(transcoder).transcoder(5, 10)

            await bondingManager
                .connect(delegator)
                .bond(1000, transcoder.address)
            await bondingManager
                .connect(delegator2)
                .bond(1000, delegator.address)

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 1
            )
            await fixture.roundsManager.execute(
                bondingManager.address,
                functionSig("setCurrentRoundTotalActiveStake()")
            )
        })

        it("should fail if current round is not initialized", async () => {
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                false
            )

            await expect(
                bondingManager.connect(delegator).unbond(500)
            ).to.be.revertedWith("current round is not initialized")
        })

        it("should fail if the caller is not bonded", async () => {
            await bondingManager.connect(delegator).unbond(1000)

            // This should fail because caller is already unbonded and not bonded
            await expect(
                bondingManager.connect(delegator).unbond(500)
            ).to.be.revertedWith("caller must be bonded")
        })

        it("should fail if amount is 0", async () => {
            await expect(
                bondingManager.connect(delegator).unbond(0)
            ).to.be.revertedWith("unbond amount must be greater than 0")
        })

        it("should fail if amount is greater than bonded amount", async () => {
            await expect(
                bondingManager.connect(delegator).unbond(1001)
            ).to.be.revertedWith("amount is greater than bonded amount")
        })

        it("should update current earningsPool totalStake when lastActiveStakeUpdateRound < currentRound", async () => {
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 2
            )
            assert.isBelow(
                (
                    await bondingManager.getTranscoder(transcoder.address)
                ).lastActiveStakeUpdateRound.toNumber(),
                currentRound + 2
            )

            await bondingManager.connect(delegator).unbond(1000)

            const lastActiveStake = (
                await bondingManager.getTranscoderEarningsPoolForRound(
                    transcoder.address,
                    currentRound + 1
                )
            ).totalStake
            const pool = await bondingManager.getTranscoderEarningsPoolForRound(
                transcoder.address,
                currentRound + 2
            )
            assert.equal(pool.totalStake.toString(), lastActiveStake.toString())
        })

        it("should not update current earningsPool totalStake when lastActiveStakeUpdateRound = currentRound", async () => {
            assert.equal(
                (
                    await bondingManager.getTranscoder(transcoder.address)
                ).lastActiveStakeUpdateRound.toNumber(),
                currentRound + 1
            )

            const startActiveStake = (
                await bondingManager.getTranscoderEarningsPoolForRound(
                    transcoder.address,
                    currentRound + 1
                )
            ).totalStake
            await bondingManager.connect(delegator).unbond(1000)
            const endActiveStake = (
                await bondingManager.getTranscoderEarningsPoolForRound(
                    transcoder.address,
                    currentRound + 1
                )
            ).totalStake

            assert.equal(startActiveStake.toString(), endActiveStake.toString())
        })

        it("should not update current earningsPool totalStake when lastActiveStakeUpdateRound > currentRound", async () => {
            await bondingManager.connect(delegator).unbond(500)
            assert.isAbove(
                (
                    await bondingManager.getTranscoder(transcoder.address)
                ).lastActiveStakeUpdateRound.toNumber(),
                currentRound + 1
            )

            const startActiveStake = (
                await bondingManager.getTranscoderEarningsPoolForRound(
                    transcoder.address,
                    currentRound + 1
                )
            ).totalStake
            await bondingManager.connect(delegator).unbond(500)
            const endActiveStake = (
                await bondingManager.getTranscoderEarningsPoolForRound(
                    transcoder.address,
                    currentRound + 1
                )
            ).totalStake

            assert.equal(startActiveStake.toString(), endActiveStake.toString())
        })

        it("should checkpoint the delegator and transcoder states", async () => {
            // make sure trancoder has a non-null `lastRewardRound`
            await bondingManager.connect(transcoder).reward()

            const tx = await bondingManager.connect(delegator).unbond(500)

            await expectCheckpoints(
                fixture,
                tx,
                {
                    account: transcoder.address,
                    startRound: currentRound + 2,
                    bondedAmount: 1000,
                    delegateAddress: transcoder.address,
                    delegatedAmount: 1500,
                    lastClaimRound: currentRound,
                    lastRewardRound: currentRound + 1
                },
                {
                    account: delegator.address,
                    startRound: currentRound + 2,
                    bondedAmount: 500,
                    delegateAddress: transcoder.address,
                    delegatedAmount: 1000, // delegator2 delegates to delegator
                    lastClaimRound: currentRound + 1, // gets updated on unbond
                    lastRewardRound: 0
                }
            )
        })

        describe("partial unbonding", () => {
            it("should create an unbonding lock for a partial unbond", async () => {
                const unbondingLockID = (
                    await bondingManager.getDelegator(delegator.address)
                )[6]
                const unbondingPeriod = (
                    await bondingManager.unbondingPeriod.call()
                ).toNumber()

                await bondingManager.connect(delegator).unbond(500)

                const lock = await bondingManager.getDelegatorUnbondingLock(
                    delegator.address,
                    unbondingLockID
                )
                assert.equal(lock[0], 500, "wrong unbonding lock amount")
                assert.equal(
                    lock[1],
                    currentRound + 1 + unbondingPeriod,
                    "wrong unbonding lock withdraw round"
                )

                const dInfo = await bondingManager.getDelegator(
                    delegator.address
                )
                assert.equal(dInfo[0], 500, "wrong delegator bonded amount")
                assert.equal(
                    dInfo[6],
                    unbondingLockID.toNumber() + 1,
                    "wrong delegator next unbonding lock ID"
                )

                const tInfo = await bondingManager.getDelegator(
                    transcoder.address
                )
                assert.equal(tInfo[3], 1500, "wrong delegate delegated amount")

                assert.equal(
                    await bondingManager.delegatorStatus(delegator.address),
                    constants.DelegatorStatus.Bonded,
                    "wrong delegator status"
                )
            })

            it("should fire an Unbond event with an unbonding lock representing a partial unbond", async () => {
                const unbondingLockID = (
                    await bondingManager.getDelegator(delegator.address)
                )[6]
                const unbondingPeriod = (
                    await bondingManager.unbondingPeriod.call()
                ).toNumber()

                const txRes = bondingManager.connect(delegator).unbond(500)

                await expect(txRes)
                    .to.emit(bondingManager, "Unbond")
                    .withArgs(
                        transcoder.address,
                        delegator.address,
                        unbondingLockID.toNumber(),
                        500,
                        currentRound + 1 + unbondingPeriod
                    )
            })

            describe("delegated to non-transcoder", () => {
                it("should not change total active stake for the next round", async () => {
                    const startTotalActiveStake =
                        await bondingManager.nextRoundTotalActiveStake()
                    await bondingManager.connect(delegator2).unbond(500)
                    const endTotalActiveStake =
                        await bondingManager.nextRoundTotalActiveStake()
                    assert.equal(
                        endTotalActiveStake.sub(startTotalActiveStake),
                        0,
                        "wrong change in nextRoundTotalActiveStake"
                    )
                })

                it("should not change delegate's lastActiveStakeUpdateRound", async () => {
                    await bondingManager.connect(delegator).unbond(500)
                    assert.equal(
                        (await bondingManager.getTranscoder(delegator.address))
                            .lastActiveStakeUpdateRound,
                        0
                    )
                })
            })

            describe("not delegated to self and delegate is registered transcoder", () => {
                it("should decrease delegated transcoder's delegated stake in pool", async () => {
                    // Caller is delegator delegated to registered transcoder (not self)
                    await bondingManager.connect(delegator).unbond(500)

                    assert.equal(
                        await bondingManager.transcoderTotalStake(
                            transcoder.address
                        ),
                        1500,
                        "wrong transcoder total stake"
                    )
                })

                it("should decrease the total stake for the next round", async () => {
                    const startTotalStake =
                        await bondingManager.nextRoundTotalActiveStake()
                    await bondingManager.connect(delegator).unbond(500)
                    const endTotalStake =
                        await bondingManager.nextRoundTotalActiveStake()
                    assert.equal(
                        startTotalStake.sub(endTotalStake),
                        500,
                        "wrong change in total next round stake"
                    )
                })

                it("should update delegate's lastActiveStakeUpdateRound", async () => {
                    await bondingManager.connect(delegator).unbond(500)
                    assert.equal(
                        (await bondingManager.getTranscoder(transcoder.address))
                            .lastActiveStakeUpdateRound,
                        currentRound + 2
                    )
                })
            })

            describe("delegated to self with non-zero bonded amount and is registered transcoder", () => {
                it("should decrease delegated transcoder's (self) delegated stake in pool", async () => {
                    // Caller is transcoder delegated to self
                    await bondingManager.connect(transcoder).unbond(500)

                    assert.equal(
                        await bondingManager.transcoderTotalStake(
                            transcoder.address
                        ),
                        1500,
                        "wrong transcoder total stake"
                    )
                })

                it("should decrease the total stake for the next round", async () => {
                    const startTotalStake =
                        await bondingManager.nextRoundTotalActiveStake()
                    await bondingManager.connect(transcoder).unbond(500)
                    const endTotalStake =
                        await bondingManager.nextRoundTotalActiveStake()
                    assert.equal(
                        startTotalStake.sub(endTotalStake),
                        500,
                        "wrong change in total next round stake"
                    )
                })

                it("should update delegate's lastActiveStakeUpdateRound", async () => {
                    await bondingManager.connect(delegator).unbond(500)
                    assert.equal(
                        (await bondingManager.getTranscoder(transcoder.address))
                            .lastActiveStakeUpdateRound,
                        currentRound + 2
                    )
                })
            })
        })

        describe("full unbonding", () => {
            it("should create an unbonding lock for a full unbond", async () => {
                const unbondingLockID = (
                    await bondingManager.getDelegator(delegator.address)
                )[6]
                const unbondingPeriod = (
                    await bondingManager.unbondingPeriod.call()
                ).toNumber()

                await bondingManager.connect(delegator).unbond(1000)

                const lock = await bondingManager.getDelegatorUnbondingLock(
                    delegator.address,
                    unbondingLockID
                )
                assert.equal(lock[0], 1000, "wrong unbonding lock amount")
                assert.equal(
                    lock[1],
                    currentRound + 1 + unbondingPeriod,
                    "wrong unbonding lock withdraw round"
                )

                const dInfo = await bondingManager.getDelegator(
                    delegator.address
                )
                assert.equal(dInfo[0], 0, "wrong delegator bonded amount")
                assert.equal(
                    dInfo[2],
                    constants.NULL_ADDRESS,
                    "wrong delegate address"
                )
                assert.equal(dInfo[4], 0, "wrong start round")

                assert.equal(
                    await bondingManager.delegatorStatus(delegator.address),
                    constants.DelegatorStatus.Unbonded,
                    "wrong delegator status"
                )
            })

            it("should fire an Unbond event with an unbonding lock representing a full unbond", async () => {
                const unbondingLockID = (
                    await bondingManager.getDelegator(delegator.address)
                )[6]
                const unbondingPeriod = (
                    await bondingManager.unbondingPeriod.call()
                ).toNumber()

                const txRes = bondingManager.connect(delegator).unbond(1000)
                await expect(txRes)
                    .to.emit(bondingManager, "Unbond")
                    .withArgs(
                        transcoder.address,
                        delegator.address,
                        unbondingLockID.toNumber(),
                        1000,
                        currentRound + 1 + unbondingPeriod
                    )
            })

            describe("is an active transcoder", () => {
                it("should resign as a transcoder", async () => {
                    // Caller is transcoder delegated to self
                    await bondingManager.connect(transcoder).unbond(1000)

                    assert.isFalse(
                        await bondingManager.isRegisteredTranscoder(
                            transcoder.address
                        ),
                        "wrong transcoder status"
                    )
                })

                it("should decrease the total stake for the next round", async () => {
                    const startTotalStake =
                        await bondingManager.nextRoundTotalActiveStake()
                    await bondingManager.connect(transcoder).unbond(1000)
                    const endTotalStake =
                        await bondingManager.nextRoundTotalActiveStake()
                    // Decrease by 2000 (delegated stake) instead of just 1000 (own bonded stake)
                    assert.equal(
                        startTotalStake.sub(endTotalStake),
                        2000,
                        "wrong change in total next round stake"
                    )
                })

                it("sets transcoder's deactivation round to next round", async () => {
                    await bondingManager.connect(transcoder).unbond(1000)
                    assert.equal(
                        (await bondingManager.getTranscoder(transcoder.address))
                            .deactivationRound,
                        currentRound + 2
                    )
                })

                it("should fire a TranscoderDeactivated event", async () => {
                    const txRes = bondingManager
                        .connect(transcoder)
                        .unbond(1000)
                    await expect(txRes)
                        .to.emit(bondingManager, "TranscoderDeactivated")
                        .withArgs(transcoder.address, currentRound + 2)
                })
            })

            describe("is not an active transcoder", () => {
                it("should not update total active stake for the next round", async () => {
                    const startTotalStake =
                        await bondingManager.nextRoundTotalActiveStake()
                    await bondingManager.connect(delegator2).unbond(1000)
                    const endTotalStake =
                        await bondingManager.nextRoundTotalActiveStake()
                    assert.equal(
                        startTotalStake.sub(endTotalStake),
                        0,
                        "wrong change in total next round stake"
                    )
                })
            })
        })
    })

    describe("checkpointBondingState", () => {
        // Keep in mind that we only test the external checkpointBondingState function here and ignore all the internal
        // checkpointing calls made automatically by BondingManager. Those internal calls are verified in the specific
        // tests for each of the other functions where the automated checkpointing is expected to happen.

        let transcoder
        let delegator
        let nonParticipant
        let currentRound

        beforeEach(async () => {
            transcoder = signers[0]
            delegator = signers[1]
            nonParticipant = signers[99]
            currentRound = 100

            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                true
            )
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundLocked()"),
                false
            )
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound
            )

            await bondingManager
                .connect(transcoder)
                .bond(1000, transcoder.address)
            await bondingManager
                .connect(transcoder)
                .transcoder(50 * PERC_MULTIPLIER, 25 * PERC_MULTIPLIER)

            await bondingManager
                .connect(delegator)
                .bond(1000, transcoder.address)
        })

        it("should fail if BondingVotes is not registered", async () => {
            await fixture.register("BondingVotes", ZERO_ADDRESS)

            await expect(
                bondingManager.checkpointBondingState(transcoder.address)
            ).to.be.revertedWith("function call to a non-contract account")
        })

        it("should call BondingVotes with non-participant zeroed state", async () => {
            const tx = await bondingManager.checkpointBondingState(
                nonParticipant.address
            )

            await expectCheckpoints(fixture, tx, {
                account: nonParticipant.address,
                startRound: currentRound + 1,
                bondedAmount: 0,
                delegateAddress: ZERO_ADDRESS,
                delegatedAmount: 0,
                lastClaimRound: 0,
                lastRewardRound: 0
            })
        })

        it("should call BondingVotes with current transcoder state", async () => {
            const tx = await bondingManager.checkpointBondingState(
                transcoder.address
            )

            await expectCheckpoints(fixture, tx, {
                account: transcoder.address,
                startRound: currentRound + 1,
                bondedAmount: 1000,
                delegateAddress: transcoder.address,
                delegatedAmount: 2000, // total amount delegated towards transcoder
                lastClaimRound: currentRound,
                lastRewardRound: 0 // reward was never called
            })
        })

        it("should call BondingVotes with current delegator state", async () => {
            const tx = await bondingManager.checkpointBondingState(
                delegator.address
            )

            await expectCheckpoints(fixture, tx, {
                account: delegator.address,
                startRound: currentRound + 1,
                bondedAmount: 1000,
                delegateAddress: transcoder.address,
                delegatedAmount: 0, // no one delegates to the delegator :'(
                lastClaimRound: currentRound,
                lastRewardRound: 0 // reward was never called
            })
        })

        describe("after reward call", () => {
            beforeEach(async () => {
                await fixture.roundsManager.setMockUint256(
                    functionSig("currentRound()"),
                    currentRound + 1
                )

                await fixture.minter.setMockUint256(
                    functionSig("createReward(uint256,uint256)"),
                    1000
                )
                await bondingManager.connect(transcoder).reward()
            })

            it("transcoder reward fields should be updated", async () => {
                const tx = await bondingManager.checkpointBondingState(
                    transcoder.address
                )

                await expectCheckpoints(fixture, tx, {
                    account: transcoder.address,
                    startRound: currentRound + 2,
                    bondedAmount: 1000, // only updated by claimEarnings call
                    delegateAddress: transcoder.address,
                    delegatedAmount: 3000, // 1000 self bonded + 1000 delegated + 1000 rewards
                    lastClaimRound: currentRound, // not updated by reward call
                    lastRewardRound: currentRound + 1
                })
            })

            it("delegator state shouldn't change", async () => {
                const tx = await bondingManager.checkpointBondingState(
                    delegator.address
                )

                await expectCheckpoints(fixture, tx, {
                    account: delegator.address,
                    startRound: currentRound + 2,
                    bondedAmount: 1000,
                    delegateAddress: transcoder.address,
                    delegatedAmount: 0,
                    lastClaimRound: currentRound,
                    lastRewardRound: 0 // still zero, only gets set for transcoders
                })
            })

            describe("after transcoder calls claimEarnings", () => {
                beforeEach(async () => {
                    await bondingManager
                        .connect(transcoder)
                        .claimEarnings(currentRound + 1)
                })

                it("transcoder bonded amount should be updated", async () => {
                    const tx = await bondingManager.checkpointBondingState(
                        transcoder.address
                    )

                    await expectCheckpoints(fixture, tx, {
                        account: transcoder.address,
                        startRound: currentRound + 2,
                        bondedAmount: 1750, // 1000 + 1000 * (50% reward cut + 50% proportional stake of the rest)
                        delegateAddress: transcoder.address,
                        delegatedAmount: 3000,
                        lastClaimRound: currentRound + 1,
                        lastRewardRound: currentRound + 1
                    })
                })

                it("delegator state shouldn't change", async () => {
                    const tx = await bondingManager.checkpointBondingState(
                        delegator.address
                    )

                    await expectCheckpoints(fixture, tx, {
                        account: delegator.address,
                        startRound: currentRound + 2,
                        bondedAmount: 1000,
                        delegateAddress: transcoder.address,
                        delegatedAmount: 0,
                        lastClaimRound: currentRound,
                        lastRewardRound: 0
                    })
                })
            })

            describe("after delegator calls claimEarnings", () => {
                beforeEach(async () => {
                    await bondingManager
                        .connect(delegator)
                        .claimEarnings(currentRound + 1)
                })

                it("transcoder state shouldn't change", async () => {
                    const tx = await bondingManager.checkpointBondingState(
                        transcoder.address
                    )

                    await expectCheckpoints(fixture, tx, {
                        account: transcoder.address,
                        startRound: currentRound + 2,
                        bondedAmount: 1000,
                        delegateAddress: transcoder.address,
                        delegatedAmount: 3000,
                        lastClaimRound: currentRound,
                        lastRewardRound: currentRound + 1
                    })
                })

                it("delegator bonded amount should be updated", async () => {
                    const tx = await bondingManager.checkpointBondingState(
                        delegator.address
                    )

                    await expectCheckpoints(fixture, tx, {
                        account: delegator.address,
                        startRound: currentRound + 2,
                        bondedAmount: 1250, // 1000 + 1000 * (1 - 50% reward cut) * (50% proportional stake)
                        delegateAddress: transcoder.address,
                        delegatedAmount: 0,
                        lastClaimRound: currentRound + 1,
                        lastRewardRound: 0
                    })
                })
            })
        })
    })

    describe("rebond", () => {
        let transcoder
        let transcoder1
        let transcoder2
        let nonTranscoder
        let delegator
        let currentRound
        let unbondingLockID

        beforeEach(async () => {
            transcoder = signers[0]
            transcoder1 = signers[1]
            transcoder2 = signers[2]
            nonTranscoder = signers[3]
            delegator = signers[4]
            currentRound = 100
            unbondingLockID = 0

            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                true
            )
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundLocked()"),
                false
            )
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound
            )

            await bondingManager
                .connect(transcoder)
                .bond(1000, transcoder.address)
            await bondingManager.connect(transcoder).transcoder(5, 10)
            await bondingManager
                .connect(delegator)
                .bond(1000, transcoder.address)
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 1
            )

            await bondingManager.connect(delegator).unbond(500)
        })

        it("should fail if system is paused", async () => {
            await fixture.controller.pause()

            await expect(
                bondingManager.connect(delegator).rebond(unbondingLockID)
            ).to.be.revertedWith("system is paused")
        })

        it("should fail if current round is not initialized", async () => {
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                false
            )

            await expect(
                bondingManager.connect(delegator).rebond(unbondingLockID)
            ).to.be.revertedWith("current round is not initialized")
        })

        it("should fail if delegator is not in the Bonded or Pending state", async () => {
            // Unbond the rest of the delegator's tokens so it is no longer has any bonded tokens
            await bondingManager.connect(delegator).unbond(500)

            await expect(
                bondingManager.connect(delegator).rebond(unbondingLockID)
            ).to.be.revertedWith("caller must be bonded")
        })

        it("should fail for invalid unbonding lock ID", async () => {
            // Unbonding lock for ID does not exist
            await expect(
                bondingManager.connect(delegator).rebond(unbondingLockID + 5)
            ).to.be.revertedWith("invalid unbonding lock ID")
        })

        it("should rebond tokens for unbonding lock to delegator's current delegate", async () => {
            await bondingManager.connect(delegator).rebond(unbondingLockID)

            const dInfo = await bondingManager.getDelegator(delegator.address)
            assert.equal(dInfo[0], 1000, "wrong delegator bonded amount")

            const tDInfo = await bondingManager.getDelegator(transcoder.address)
            assert.equal(tDInfo[3], 2000, "wrong delegate delegated amount")

            const lock = await bondingManager.getDelegatorUnbondingLock(
                delegator.address,
                unbondingLockID
            )
            assert.equal(lock[0], 0, "wrong lock amount should be 0")
            assert.equal(lock[1], 0, "wrong lock withdrawRound should be 0")
        })

        it("should checkpoint the delegator and transcoder states", async () => {
            // make sure trancoder has a non-null `lastRewardRound`
            await bondingManager.connect(transcoder).reward()

            const tx = await bondingManager
                .connect(delegator)
                .rebond(unbondingLockID)

            await expectCheckpoints(
                fixture,
                tx,
                {
                    account: transcoder.address,
                    startRound: currentRound + 2,
                    bondedAmount: 1000,
                    delegateAddress: transcoder.address,
                    delegatedAmount: 2000,
                    lastClaimRound: currentRound,
                    lastRewardRound: currentRound + 1
                },
                {
                    account: delegator.address,
                    startRound: currentRound + 2,
                    bondedAmount: 1000,
                    delegateAddress: transcoder.address,
                    delegatedAmount: 0,
                    lastClaimRound: currentRound + 1,
                    lastRewardRound: 0
                }
            )
        })

        describe("current delegate is a registered transcoder", () => {
            it("should increase transcoder's delegated stake in pool", async () => {
                await bondingManager.connect(delegator).rebond(unbondingLockID)

                assert.equal(
                    await bondingManager.transcoderTotalStake(
                        transcoder.address
                    ),
                    2000,
                    "wrong transcoder total stake"
                )
            })

            it("should increase total active stake for the next round", async () => {
                const startTotalActiveStake =
                    await bondingManager.nextRoundTotalActiveStake()
                await bondingManager.connect(delegator).rebond(unbondingLockID)
                const endTotalActiveStake =
                    await bondingManager.nextRoundTotalActiveStake()
                assert.equal(
                    endTotalActiveStake.sub(startTotalActiveStake),
                    500,
                    "wrong change in nextRoundTotalActiveStake"
                )
            })

            it("should update delegate's lastActiveStakeUpdateRound", async () => {
                await bondingManager.connect(delegator).rebond(unbondingLockID)
                assert.equal(
                    (await bondingManager.getTranscoder(transcoder.address))
                        .lastActiveStakeUpdateRound,
                    currentRound + 2
                )
            })

            it("should evict when rebonding and pool is full", async () => {
                await bondingManager
                    .connect(transcoder1)
                    .bond(1900, transcoder1.address)
                await bondingManager.connect(transcoder1).transcoder(5, 10)
                await bondingManager
                    .connect(transcoder2)
                    .bond(1800, transcoder2.address)
                await bondingManager.connect(transcoder2).transcoder(5, 10)

                const txRes = bondingManager
                    .connect(delegator)
                    .rebond(unbondingLockID)
                await expect(txRes)
                    .to.emit(bondingManager, "TranscoderDeactivated")
                    .withArgs(transcoder2.address, currentRound + 2)

                await fixture.roundsManager.setMockUint256(
                    functionSig("currentRound()"),
                    currentRound + 2
                )
                assert.isTrue(
                    await bondingManager.isActiveTranscoder(transcoder.address)
                )
                // Check that transcoder2's deactivation round is the next round
                assert.equal(
                    (await bondingManager.getTranscoder(transcoder2.address))
                        .deactivationRound,
                    currentRound + 2
                )
                const pool =
                    await bondingManager.getTranscoderEarningsPoolForRound(
                        transcoder.address,
                        currentRound + 2
                    )
                assert.equal(pool.totalStake.toNumber(), 2000)
            })
        })

        describe("current delegate is not a registered transcoder", () => {
            beforeEach(async () => {
                // Delegate to a non-transcoder i.e. self
                await bondingManager
                    .connect(delegator)
                    .bond(0, nonTranscoder.address)
            })

            it("should not change total active stake for the next round", async () => {
                const startTotalActiveStake =
                    await bondingManager.nextRoundTotalActiveStake()
                await bondingManager.connect(delegator).rebond(unbondingLockID)
                const endTotalActiveStake =
                    await bondingManager.nextRoundTotalActiveStake()
                assert.equal(
                    endTotalActiveStake.sub(startTotalActiveStake),
                    0,
                    "wrong change in nextRoundTotalActiveStake"
                )
            })

            it("should not update delegate's lastActiveStakeUpdateRound", async () => {
                await bondingManager.connect(delegator).rebond(unbondingLockID)
                assert.equal(
                    (await bondingManager.getTranscoder(nonTranscoder.address))
                        .lastActiveStakeUpdateRound,
                    0
                )
            })
        })

        it("should create an Rebond event", async () => {
            const txRes = bondingManager
                .connect(delegator)
                .rebond(unbondingLockID)
            await expect(txRes)
                .to.emit(bondingManager, "Rebond")
                .withArgs(
                    transcoder.address,
                    delegator.address,
                    unbondingLockID,
                    500
                )
        })
    })

    describe("rebondFromUnbonded", () => {
        let transcoder
        let delegator
        let nonTranscoder
        let currentRound
        let unbondingLockID

        beforeEach(async () => {
            transcoder = signers[0]
            delegator = signers[1]
            nonTranscoder = signers[3]
            currentRound = 100
            unbondingLockID = 0

            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                true
            )
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundLocked()"),
                false
            )
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound
            )

            await bondingManager
                .connect(transcoder)
                .bond(1000, transcoder.address)
            await bondingManager.connect(transcoder).transcoder(5, 10)
            await bondingManager
                .connect(delegator)
                .bond(1000, transcoder.address)

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 1
            )
            await bondingManager.connect(delegator).unbond(500)
        })

        it("should fail if system is paused", async () => {
            // Delegator unbonds rest of tokens transitioning to the Unbonded state
            await bondingManager.connect(delegator).unbond(500)
            await fixture.controller.pause()

            await expect(
                bondingManager
                    .connect(delegator)
                    .rebondFromUnbonded(transcoder.address, unbondingLockID)
            ).to.be.revertedWith("system is paused")
        })

        it("should fail if current round is not initialized", async () => {
            // Delegator unbonds rest of tokens transitioning to the Unbonded state
            await bondingManager.connect(delegator).unbond(500)
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                false
            )

            await expect(
                bondingManager
                    .connect(delegator)
                    .rebondFromUnbonded(transcoder.address, unbondingLockID)
            ).to.be.revertedWith("current round is not initialized")
        })

        it("should fail if delegator is not in Unbonded state", async () => {
            await expect(
                bondingManager
                    .connect(delegator)
                    .rebondFromUnbonded(transcoder.address, unbondingLockID)
            ).to.be.revertedWith("caller must be unbonded")
        })

        it("should fail for invalid unbonding lock ID", async () => {
            // Delegator unbonds rest of tokens transitioning to the Unbonded state
            await bondingManager.connect(delegator).unbond(500)

            // Unbonding lock for ID does not exist
            await expect(
                bondingManager
                    .connect(delegator)
                    .rebondFromUnbonded(transcoder.address, unbondingLockID + 5)
            ).to.be.revertedWith("invalid unbonding lock ID")
        })

        it("should set delegator's start round and delegate address", async () => {
            // Delegator unbonds rest of tokens transitioning to the Unbonded state
            await bondingManager.connect(delegator).unbond(500)

            await bondingManager
                .connect(delegator)
                .rebondFromUnbonded(transcoder.address, unbondingLockID)

            const dInfo = await bondingManager.getDelegator(delegator.address)
            assert.equal(dInfo[2], transcoder.address, "wrong delegate address")
            assert.equal(dInfo[4], currentRound + 2, "wrong start round")
        })

        it("should rebond tokens for unbonding lock to new delegate", async () => {
            // Delegator unbonds rest of tokens transitioning to the Unbonded state
            await bondingManager.connect(delegator).unbond(500)

            await bondingManager
                .connect(delegator)
                .rebondFromUnbonded(transcoder.address, unbondingLockID)

            const dInfo = await bondingManager.getDelegator(delegator.address)
            assert.equal(dInfo[0], 500, "wrong delegator bonded amount")

            const tDInfo = await bondingManager.getDelegator(transcoder.address)
            assert.equal(tDInfo[3], 1500, "wrong delegate delegated amount")

            const lock = await bondingManager.getDelegatorUnbondingLock(
                delegator.address,
                unbondingLockID
            )
            assert.equal(lock[0], 0, "wrong lock amount should be 0")
            assert.equal(lock[1], 0, "wrong lock withdrawRound should be 0")
        })

        it("should checkpoint the delegator and transcoder states", async () => {
            // make sure trancoder has a non-null `lastRewardRound`
            await bondingManager.connect(transcoder).reward()

            // Delegator unbonds rest of tokens transitioning to the Unbonded state
            await bondingManager.connect(delegator).unbond(500)

            const tx = await bondingManager
                .connect(delegator)
                .rebondFromUnbonded(transcoder.address, unbondingLockID)

            await expectCheckpoints(
                fixture,
                tx,
                {
                    account: transcoder.address,
                    startRound: currentRound + 2,
                    bondedAmount: 1000,
                    delegateAddress: transcoder.address,
                    delegatedAmount: 1500,
                    lastClaimRound: currentRound,
                    lastRewardRound: currentRound + 1
                },
                {
                    account: delegator.address,
                    startRound: currentRound + 2,
                    bondedAmount: 500,
                    delegateAddress: transcoder.address,
                    delegatedAmount: 0,
                    lastClaimRound: currentRound + 1,
                    lastRewardRound: 0
                }
            )
        })

        describe("new delegate is a registered transcoder", () => {
            beforeEach(async () => {
                // Delegator unbonds rest of tokens transitioning to the Unbonded state
                await bondingManager.connect(delegator).unbond(500)
            })
            it("should increase transcoder's delegated stake in pool", async () => {
                await bondingManager
                    .connect(delegator)
                    .rebondFromUnbonded(transcoder.address, unbondingLockID)
                assert.equal(
                    await bondingManager.transcoderTotalStake(
                        transcoder.address
                    ),
                    1500,
                    "wrong transcoder total stake"
                )
            })

            it("should increase the total active stake for the next round", async () => {
                const startTotalActiveStake =
                    await bondingManager.nextRoundTotalActiveStake()
                await bondingManager
                    .connect(delegator)
                    .rebondFromUnbonded(transcoder.address, unbondingLockID)
                const endTotalActiveStake =
                    await bondingManager.nextRoundTotalActiveStake()
                assert.equal(
                    endTotalActiveStake.sub(startTotalActiveStake),
                    500,
                    "wrong change in nextRoundTotalActiveStake"
                )
            })

            it("should update delegate's lastActiveStakeUpdateRound", async () => {
                await bondingManager
                    .connect(delegator)
                    .rebondFromUnbonded(transcoder.address, unbondingLockID)
                assert.equal(
                    (await bondingManager.getTranscoder(transcoder.address))
                        .lastActiveStakeUpdateRound,
                    currentRound + 2
                )
            })
        })

        describe("new delegate is not a registered transcoder", () => {
            beforeEach(async () => {
                // Delegator unbonds rest of tokens transitioning to the Unbonded state
                // 500 is unbonded from transcoder in the active pool
                await bondingManager.connect(delegator).unbond(500)
            })

            it("should not change the total active stake for the next round", async () => {
                const startTotalActiveStake =
                    await bondingManager.nextRoundTotalActiveStake()
                await bondingManager
                    .connect(delegator)
                    .rebondFromUnbonded(nonTranscoder.address, unbondingLockID)
                const endTotalActiveStake =
                    await bondingManager.nextRoundTotalActiveStake()
                assert.equal(
                    endTotalActiveStake.sub(startTotalActiveStake),
                    0,
                    "wrong change in nextRoundTotalActiveStake"
                )
            })

            it("should not update delegate's lastActiveStakeUpdateRound", async () => {
                await bondingManager
                    .connect(delegator)
                    .rebondFromUnbonded(nonTranscoder.address, unbondingLockID)
                assert.equal(
                    (await bondingManager.getTranscoder(nonTranscoder.address))
                        .lastActiveStakeUpdateRound,
                    0
                )
            })
        })

        it("should create a Rebond event", async () => {
            // Delegator unbonds rest of tokens transitioning to the Unbonded state
            await bondingManager.connect(delegator).unbond(500)

            const txRes = bondingManager
                .connect(delegator)
                .rebondFromUnbonded(transcoder.address, unbondingLockID)
            await expect(txRes)
                .to.emit(bondingManager, "Rebond")
                .withArgs(
                    transcoder.address,
                    delegator.address,
                    unbondingLockID,
                    500
                )
        })
    })

    describe("transferBond", () => {
        let transcoder0
        let transcoder1
        let delegator1
        let delegator2
        let delegator3
        let delegator4
        const currentRound = 100

        beforeEach(async () => {
            transcoder0 = signers[0]
            transcoder1 = signers[1]
            delegator1 = signers[3]
            delegator2 = signers[4]
            delegator3 = signers[5]
            delegator4 = signers[6]

            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                true
            )
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundLocked()"),
                false
            )
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound - 1
            )
            await bondingManager
                .connect(transcoder0)
                .bond(1000, transcoder0.address)
            await bondingManager.connect(transcoder0).transcoder(5, 10)
            await bondingManager
                .connect(transcoder1)
                .bond(2000, transcoder1.address)
            await bondingManager.connect(transcoder1).transcoder(5, 10)
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound
            )
        })

        describe("caller is transferring bond to another address", () => {
            beforeEach(async () => {
                await bondingManager
                    .connect(delegator1)
                    .bond(2000, transcoder0.address)
                await bondingManager
                    .connect(delegator3)
                    .bond(2000, delegator4.address)
                await fixture.roundsManager.setMockUint256(
                    functionSig("currentRound()"),
                    currentRound + 2
                )
            })

            it("should emit Unbond, TransferBond and Rebond events", async () => {
                const expectEvents = async (
                    expOldUnbondingLockId,
                    expNewUnbondingLockId
                ) => {
                    const delegate = transcoder0.address
                    const amount = 1
                    const withdrawRound = currentRound + 2 + UNBONDING_PERIOD

                    const tx = await bondingManager
                        .connect(delegator1)
                        .transferBond(
                            delegator2.address,
                            amount,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS
                        )

                    await expect(tx)
                        .to.emit(bondingManager, "Unbond")
                        .withArgs(
                            delegate,
                            delegator1.address,
                            expOldUnbondingLockId,
                            amount,
                            withdrawRound
                        )
                    await expect(tx)
                        .to.emit(bondingManager, "TransferBond")
                        .withArgs(
                            delegator1.address,
                            delegator2.address,
                            expOldUnbondingLockId,
                            expNewUnbondingLockId,
                            amount
                        )
                    await expect(tx)
                        .to.emit(bondingManager, "Rebond")
                        .withArgs(
                            delegate,
                            delegator2.address,
                            expNewUnbondingLockId,
                            amount
                        )
                }

                // nextUnbondingLockId should increase for each delegator after each transferBond() call
                await expectEvents(0, 0)
                await expectEvents(1, 1)
                await expectEvents(2, 2)
            })

            describe("receiver is not bonded", () => {
                it("should fail if caller is delegated to receiver", async () => {
                    const tx = bondingManager
                        .connect(delegator3)
                        .transferBond(
                            delegator4.address,
                            1,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS
                        )

                    await expect(tx).to.be.revertedWith("INVALID_DELEGATOR")
                })

                it("should transfer the bond to receiver", async () => {
                    const d1BondedAmountStart = (
                        await bondingManager.getDelegator(delegator1.address)
                    ).bondedAmount
                    const d2BondedAmountStart = (
                        await bondingManager.getDelegator(delegator2.address)
                    ).bondedAmount

                    expect(d1BondedAmountStart).to.equal(2000)
                    expect(d2BondedAmountStart).to.equal(0)

                    expect(
                        (await bondingManager.getDelegator(delegator2.address))
                            .lastClaimRound
                    ).to.not.equal(currentRound + 2)

                    await bondingManager
                        .connect(delegator1)
                        .transferBond(
                            delegator2.address,
                            1800,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS
                        )

                    const d1BondedAmount = (
                        await bondingManager.getDelegator(delegator1.address)
                    ).bondedAmount
                    const d2BondedAmount = (
                        await bondingManager.getDelegator(delegator2.address)
                    ).bondedAmount

                    const d1 = await bondingManager.getDelegator(
                        delegator1.address
                    )
                    const d2 = await bondingManager.getDelegator(
                        delegator2.address
                    )

                    const d1DelegateAddress = d1.delegateAddress
                    const d2DelegateAddress = d2.delegateAddress

                    const d1LastClaimRound = d1.lastClaimRound
                    const d2LastClaimRound = d2.lastClaimRound

                    expect(d1BondedAmount).to.equal(
                        200,
                        "wrong bonded amount for delegator 1"
                    )
                    expect(d2BondedAmount).to.equal(
                        1800,
                        "wrong bonded amount for delegator 2"
                    )

                    expect(d1DelegateAddress).to.equal(
                        transcoder0.address,
                        "wrong delegate for delegator 1"
                    )
                    expect(d2DelegateAddress).to.equal(
                        transcoder0.address,
                        "wrong delegate for delegator 2"
                    )

                    expect(d1LastClaimRound).to.equal(currentRound + 2)
                    expect(d2LastClaimRound).to.equal(currentRound + 2)
                })

                it("should set non-null delegate address for receiver when the caller becomes fully unbonded", async () => {
                    const delegate = (
                        await bondingManager.getDelegator(delegator1.address)
                    ).delegateAddress
                    const pendingStake = await bondingManager.pendingStake(
                        delegator1.address,
                        0
                    )

                    await bondingManager
                        .connect(delegator1)
                        .transferBond(
                            delegator2.address,
                            pendingStake,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS
                        )

                    // Caller becomes fully unbonded
                    const info = await bondingManager.getDelegator(
                        delegator1.address
                    )
                    expect(info.delegateAddress).to.equal(ZERO_ADDRESS)
                    expect(info.bondedAmount).to.equal(0)
                    expect(
                        await bondingManager.delegatorStatus(delegator1.address)
                    ).to.be.equal(DelegatorStatus.Unbonded)

                    // Receiver's delegate is set to caller's delegate before fully unbonding
                    expect(
                        (await bondingManager.getDelegator(delegator2.address))
                            .delegateAddress
                    ).to.equal(delegate)
                })
            })

            describe("receiver is bonded to the same transcoder", () => {
                beforeEach(async () => {
                    await bondingManager
                        .connect(delegator2)
                        .bond(2000, transcoder0.address)
                    await fixture.roundsManager.setMockUint256(
                        functionSig("currentRound()"),
                        currentRound + 3
                    )
                })

                it("should transfer the bond to receiver", async () => {
                    const d1BondedAmountStart = (
                        await bondingManager.getDelegator(delegator1.address)
                    ).bondedAmount
                    const d2BondedAmountStart = (
                        await bondingManager.getDelegator(delegator2.address)
                    ).bondedAmount

                    const delegatedAmountStart = (
                        await bondingManager.getDelegator(transcoder0.address)
                    ).delegatedAmount

                    expect(d1BondedAmountStart).to.equal(2000)
                    expect(d2BondedAmountStart).to.equal(2000)

                    expect(
                        (await bondingManager.getDelegator(delegator2.address))
                            .lastClaimRound
                    ).to.not.equal(currentRound + 3)

                    await bondingManager
                        .connect(delegator1)
                        .transferBond(
                            delegator2.address,
                            1800,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS
                        )

                    const delegatedAmountEnd = (
                        await bondingManager.getDelegator(transcoder0.address)
                    ).delegatedAmount
                    expect(delegatedAmountEnd).to.equal(delegatedAmountStart)

                    const d1 = await bondingManager.getDelegator(
                        delegator1.address
                    )
                    const d2 = await bondingManager.getDelegator(
                        delegator2.address
                    )

                    const d1BondedAmount = d1.bondedAmount
                    const d2BondedAmount = d2.bondedAmount

                    const d1DelegateAddress = d1.delegateAddress
                    const d2DelegateAddress = d2.delegateAddress

                    const d1LastClaimRound = d1.lastClaimRound
                    const d2LastClaimRound = d2.lastClaimRound

                    expect(d1BondedAmount).to.equal(
                        200,
                        "wrong bonded amount for delegator 1"
                    )
                    expect(d2BondedAmount).to.equal(
                        3800,
                        "wrong bonded amount for delegator 2"
                    )

                    expect(d1DelegateAddress).to.equal(
                        transcoder0.address,
                        "wrong delegate for delegator 1"
                    )
                    expect(d2DelegateAddress).to.equal(
                        transcoder0.address,
                        "wrong delegate for delegator 2"
                    )

                    expect(d1LastClaimRound).to.equal(currentRound + 3)
                    expect(d2LastClaimRound).to.equal(currentRound + 3)
                })
            })

            describe("receiver is bonded to a different transcoder", () => {
                beforeEach(async () => {
                    await bondingManager
                        .connect(delegator2)
                        .bond(2000, transcoder1.address)
                    await fixture.roundsManager.setMockUint256(
                        functionSig("currentRound()"),
                        currentRound + 3
                    )
                })

                it("should transfer the bond to receiver", async () => {
                    const d1BondedAmountStart = (
                        await bondingManager.getDelegator(delegator1.address)
                    ).bondedAmount
                    const d2BondedAmountStart = (
                        await bondingManager.getDelegator(delegator2.address)
                    ).bondedAmount

                    const t0DelegatedAmountStart = (
                        await bondingManager.getDelegator(transcoder0.address)
                    ).delegatedAmount
                    const t1DelegatedAmountStart = (
                        await bondingManager.getDelegator(transcoder1.address)
                    ).delegatedAmount

                    expect(d1BondedAmountStart).to.equal(2000)
                    expect(d2BondedAmountStart).to.equal(2000)

                    await bondingManager
                        .connect(delegator1)
                        .transferBond(
                            delegator2.address,
                            1800,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS
                        )

                    const d1 = await bondingManager.getDelegator(
                        delegator1.address
                    )
                    const d2 = await bondingManager.getDelegator(
                        delegator2.address
                    )

                    const d1BondedAmount = d1.bondedAmount
                    const d2BondedAmount = d2.bondedAmount

                    const d1DelegateAddress = d1.delegateAddress
                    const d2DelegateAddress = d2.delegateAddress

                    const d1LastClaimRound = d1.lastClaimRound
                    const d2LastClaimRound = d2.lastClaimRound

                    expect(d1BondedAmount).to.equal(
                        200,
                        "wrong bonded amount for delegator 1"
                    )
                    expect(d2BondedAmount).to.equal(
                        3800,
                        "wrong bonded amount for delegator 2"
                    )

                    expect(d1DelegateAddress).to.equal(
                        transcoder0.address,
                        "wrong delegate for delegator 1"
                    )
                    expect(d2DelegateAddress).to.equal(
                        transcoder1.address,
                        "wrong delegate for delegator 2"
                    )

                    const t0DelegatedAmountEnd = (
                        await bondingManager.getDelegator(transcoder0.address)
                    ).delegatedAmount
                    const t1DelegatedAmountEnd = (
                        await bondingManager.getDelegator(transcoder1.address)
                    ).delegatedAmount

                    expect(
                        t0DelegatedAmountEnd.sub(t0DelegatedAmountStart)
                    ).to.equal(-1800, "incorrect t0 delegatedAmount")
                    expect(
                        t1DelegatedAmountEnd.sub(t1DelegatedAmountStart)
                    ).to.equal(1800, "incorrect t1 delegatedAmount")

                    expect(d1LastClaimRound).to.equal(currentRound + 3)
                    expect(d2LastClaimRound).to.equal(currentRound + 3)
                })

                it("should checkpoint both delegators and transcoders states", async () => {
                    // make sure trancoder has a non-null `lastRewardRound`
                    await bondingManager.connect(transcoder0).reward()

                    const tx = await bondingManager
                        .connect(delegator1)
                        .transferBond(
                            delegator2.address,
                            1800,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS
                        )

                    await expectCheckpoints(
                        fixture,
                        tx,
                        {
                            account: transcoder0.address,
                            startRound: currentRound + 4,
                            bondedAmount: 1000,
                            delegateAddress: transcoder0.address,
                            delegatedAmount: 1200,
                            lastClaimRound: currentRound - 1,
                            lastRewardRound: currentRound + 3
                        },
                        {
                            account: delegator1.address,
                            startRound: currentRound + 4,
                            bondedAmount: 200,
                            delegateAddress: transcoder0.address,
                            delegatedAmount: 0,
                            lastClaimRound: currentRound + 3,
                            lastRewardRound: 0
                        },
                        {
                            account: transcoder1.address,
                            startRound: currentRound + 4,
                            bondedAmount: 2000,
                            delegateAddress: transcoder1.address,
                            delegatedAmount: 5800,
                            lastClaimRound: currentRound - 1,
                            lastRewardRound: 0
                        },
                        {
                            account: delegator2.address,
                            startRound: currentRound + 4,
                            bondedAmount: 3800,
                            delegateAddress: transcoder1.address,
                            delegatedAmount: 0,
                            lastClaimRound: currentRound + 3,
                            lastRewardRound: 0
                        }
                    )
                })
            })

            describe("receiver is bonded to zero address", () => {
                beforeEach(async () => {
                    await bondingManager
                        .connect(delegator2)
                        .bond(2000, ethers.constants.AddressZero)
                    await fixture.roundsManager.setMockUint256(
                        functionSig("currentRound()"),
                        currentRound + 3
                    )
                })

                it("should not set delegate of sender as delegate of receiver", async () => {
                    const d1 = await bondingManager.getDelegator(
                        delegator1.address
                    )
                    const d2 = await bondingManager.getDelegator(
                        delegator2.address
                    )

                    const delegate1InfoInitial =
                        await bondingManager.getDelegator(d1.delegateAddress)
                    const initialAmount1 = delegate1InfoInitial.delegatedAmount

                    const delegate2InfoInitial =
                        await bondingManager.getDelegator(d2.delegateAddress)
                    const initialAmount2 = delegate2InfoInitial.delegatedAmount

                    await bondingManager
                        .connect(delegator1)
                        .transferBond(
                            delegator2.address,
                            1,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS,
                            ZERO_ADDRESS
                        )

                    const d2Final = await bondingManager.getDelegator(
                        delegator2.address
                    )
                    const delegate1InfoFinal =
                        await bondingManager.getDelegator(d1.delegateAddress)
                    const delegate2InfoFinal =
                        await bondingManager.getDelegator(
                            d2Final.delegateAddress
                        )

                    const finalAmount1 = delegate1InfoFinal.delegatedAmount
                    const finalAmount2 = delegate2InfoFinal.delegatedAmount

                    expect(finalAmount1).to.equal(initialAmount1.sub(1))
                    expect(finalAmount2).to.equal(initialAmount2.add(1))
                    expect(d2Final.delegateAddress).to.equal(
                        ethers.constants.AddressZero
                    )
                })
            })
        })
    })

    describe("withdrawStake", () => {
        let transcoder
        let delegator
        let currentRound
        let unbondingLockID

        beforeEach(async () => {
            transcoder = signers[0]
            delegator = signers[1]
            currentRound = 100
            unbondingLockID = 0

            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                true
            )
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundLocked()"),
                false
            )
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound
            )

            await bondingManager
                .connect(transcoder)
                .bond(1000, transcoder.address)
            await bondingManager.connect(transcoder).transcoder(5, 10)
            await bondingManager
                .connect(delegator)
                .bond(1000, transcoder.address)

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 1
            )
            await bondingManager.connect(delegator).unbond(500)
        })

        it("should fail if system is paused", async () => {
            await fixture.controller.pause()

            await expect(
                bondingManager.connect(delegator).withdrawStake(unbondingLockID)
            ).to.be.revertedWith("system is paused")
        })

        it("should fail if current round is not initialized", async () => {
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                false
            )

            await expect(
                bondingManager.connect(delegator).withdrawStake(unbondingLockID)
            ).to.be.revertedWith("current round is not initialized")
        })

        it("should fail if unbonding lock is invalid", async () => {
            // Unbonding lock for ID does not exist
            await expect(
                bondingManager
                    .connect(delegator)
                    .withdrawStake(unbondingLockID + 5)
            ).to.be.revertedWith("invalid unbonding lock ID")
        })

        it("should fail if unbonding lock withdraw round is in the future", async () => {
            await expect(
                bondingManager.connect(delegator).withdrawStake(unbondingLockID)
            ).revertedWith(
                "withdraw round must be before or equal to the current round"
            )
        })

        it("should withdraw tokens for unbonding lock", async () => {
            const unbondingPeriod = (
                await bondingManager.unbondingPeriod.call()
            ).toNumber()
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 1 + unbondingPeriod
            )

            await bondingManager
                .connect(delegator)
                .withdrawStake(unbondingLockID)

            const lock = await bondingManager.getDelegatorUnbondingLock(
                delegator.address,
                unbondingLockID
            )
            assert.equal(lock[0], 0, "wrong lock amount should be 0")
            assert.equal(lock[1], 0, "wrong lock withdrawRound should be 0")
        })

        it("should create an WithdrawStake event", async () => {
            const unbondingPeriod = (
                await bondingManager.unbondingPeriod.call()
            ).toNumber()
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 1 + unbondingPeriod
            )

            const txRes = bondingManager
                .connect(delegator)
                .withdrawStake(unbondingLockID)
            await expect(txRes)
                .to.emit(bondingManager, "WithdrawStake")
                .withArgs(
                    delegator.address,
                    unbondingLockID,
                    500,
                    currentRound + 1 + unbondingPeriod
                )
        })
    })

    describe("withdrawFees", () => {
        let transcoder0
        let transcoder1
        let recipient
        let currentRound

        beforeEach(async () => {
            transcoder0 = signers[0]
            transcoder1 = signers[1]
            recipient = signers[2]
            currentRound = 100

            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                true
            )
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundLocked()"),
                false
            )
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound
            )

            await bondingManager
                .connect(transcoder0)
                .bond(1000, transcoder0.address)
            await bondingManager.connect(transcoder0).transcoder(5, 10)
            await bondingManager
                .connect(transcoder1)
                .bond(1000, transcoder1.address)
            await bondingManager.connect(transcoder1).transcoder(5, 10)

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 1
            )
            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder0.address, 1000, currentRound + 1]
                )
            )
        })

        it("should fail if system is paused", async () => {
            await fixture.controller.pause()

            await expect(
                bondingManager
                    .connect(transcoder0)
                    .withdrawFees(transcoder0.address, 1)
            ).to.be.revertedWith("system is paused")
        })

        it("should fail if current round is not initialized", async () => {
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                false
            )

            await expect(
                bondingManager
                    .connect(transcoder0)
                    .withdrawFees(transcoder0.address, 1)
            ).to.be.revertedWith("current round is not initialized")
        })

        it("should fail if the recipient is null", async () => {
            await expect(
                bondingManager
                    .connect(transcoder1)
                    .withdrawFees(ethers.constants.AddressZero, 1)
            ).to.be.revertedWith("invalid recipient")
        })

        it("should fail if there are no fees to withdraw", async () => {
            const fees = (
                await bondingManager.getDelegator(transcoder0.address)
            ).fees

            await expect(
                bondingManager
                    .connect(transcoder1)
                    .withdrawFees(transcoder0.address, fees.add(1))
            ).to.be.revertedWith("insufficient fees to withdraw")
        })

        it("should partially withdraw caller's fees", async () => {
            await bondingManager
                .connect(transcoder0)
                .claimEarnings(currentRound + 1)

            const startFees = (
                await bondingManager.getDelegator(transcoder0.address)
            ).fees
            expect(startFees).to.be.not.equal(0)

            const amount = 500
            const tx = await bondingManager
                .connect(transcoder0)
                .withdrawFees(recipient.address, amount)

            const dInfo = await bondingManager.getDelegator(transcoder0.address)
            expect(dInfo.lastClaimRound).to.be.equal(currentRound + 1)
            expect(dInfo.fees).to.be.equal(startFees.sub(amount))

            await expect(tx)
                .to.emit(bondingManager, "WithdrawFees")
                .withArgs(transcoder0.address, recipient.address, amount)
        })

        it("should fully withdraw caller's fees", async () => {
            const fees = await bondingManager.pendingFees(
                transcoder0.address,
                currentRound + 1
            )
            expect(fees).to.be.not.equal(0)

            const tx = await bondingManager
                .connect(transcoder0)
                .withdrawFees(recipient.address, fees)

            expect(
                await bondingManager.pendingFees(
                    transcoder0.address,
                    currentRound + 1
                )
            ).to.be.equal(0)
            const dInfo = await bondingManager.getDelegator(transcoder0.address)
            expect(dInfo.lastClaimRound).to.be.equal(currentRound + 1)
            expect(dInfo.fees).to.be.equal(0)

            await expect(tx)
                .to.emit(bondingManager, "WithdrawFees")
                .withArgs(transcoder0.address, recipient.address, fees)
        })

        it("should withdraw caller's fees after more are earned", async () => {
            const startFees = await bondingManager.pendingFees(
                transcoder0.address,
                currentRound + 1
            )
            expect(startFees).to.be.not.equal(0)

            const amount = 500
            let tx = await bondingManager
                .connect(transcoder0)
                .withdrawFees(recipient.address, amount)

            const endFees0 = await bondingManager.pendingFees(
                transcoder0.address,
                currentRound + 1
            )
            expect(endFees0).to.be.equal(startFees.sub(amount))

            await expect(tx)
                .to.emit(bondingManager, "WithdrawFees")
                .withArgs(transcoder0.address, recipient.address, amount)

            const newFees = 1000
            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder0.address, newFees, currentRound + 1]
                )
            )

            tx = await bondingManager
                .connect(transcoder0)
                .withdrawFees(recipient.address, amount)

            const endFees1 = await bondingManager.pendingFees(
                transcoder0.address,
                currentRound + 1
            )
            expect(endFees1).to.be.equal(
                startFees.sub(amount).add(newFees).sub(amount)
            )

            await expect(tx)
                .to.emit(bondingManager, "WithdrawFees")
                .withArgs(transcoder0.address, recipient.address, amount)
        })
    })

    describe("reward", () => {
        let transcoder
        let nonTranscoder
        let currentRound

        beforeEach(async () => {
            transcoder = signers[0]
            nonTranscoder = signers[1]
            currentRound = 100

            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                true
            )
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundLocked()"),
                false
            )
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound
            )

            await bondingManager
                .connect(transcoder)
                .bond(1000, transcoder.address)
            await bondingManager
                .connect(transcoder)
                .transcoder(50 * PERC_MULTIPLIER, 10)

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 1
            )
            await fixture.minter.setMockUint256(
                functionSig("createReward(uint256,uint256)"),
                1000
            )
        })

        it("should fail if system is paused", async () => {
            await fixture.controller.pause()

            await expect(
                bondingManager.connect(transcoder).reward()
            ).to.be.revertedWith("system is paused")
        })

        it("should fail if current round is not initialized", async () => {
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                false
            )

            await expect(
                bondingManager.connect(transcoder).reward()
            ).to.be.revertedWith("current round is not initialized")
        })

        it("should fail if caller is not an active transcoder for the current round", async () => {
            await expect(
                bondingManager.connect(nonTranscoder).reward()
            ).to.be.revertedWith("caller must be an active transcoder")
        })

        it("should fail if caller already called reward during the current round", async () => {
            await bondingManager.connect(transcoder).reward()
            // This should fail because transcoder already called reward during the current round
            await expect(
                bondingManager.connect(transcoder).reward()
            ).to.be.revertedWith(
                "caller has already called reward for the current round"
            )
        })

        it("should update caller with rewards", async () => {
            const startDelegatedAmount = (
                await bondingManager.getDelegator(transcoder.address)
            )[3]
            const startTotalStake = await bondingManager.transcoderTotalStake(
                transcoder.address
            )
            const startNextTotalStake =
                await bondingManager.nextRoundTotalActiveStake()
            await bondingManager.connect(transcoder).reward()
            const endDelegatedAmount = (
                await bondingManager.getDelegator(transcoder.address)
            )[3]
            const endTotalStake = await bondingManager.transcoderTotalStake(
                transcoder.address
            )
            const endNextTotalStake =
                await bondingManager.nextRoundTotalActiveStake()

            const earningsPool =
                await bondingManager.getTranscoderEarningsPoolForRound(
                    transcoder.address,
                    currentRound + 1
                )
            const expRewardFactor = constants.PERC_DIVISOR_PRECISE.add(
                math.precise.percPoints(
                    BigNumber.from(500),
                    BigNumber.from(1000)
                )
            )
            assert.equal(
                earningsPool.cumulativeRewardFactor.toString(),
                expRewardFactor.toString(),
                "should update cumulativeRewardFactor in earningsPool"
            )

            assert.equal(
                endDelegatedAmount.sub(startDelegatedAmount),
                1000,
                "should update delegatedAmount with new rewards"
            )
            assert.equal(
                endTotalStake.sub(startTotalStake),
                1000,
                "should update transcoder's total stake in the pool with new rewards"
            )
            assert.equal(
                endNextTotalStake.sub(startNextTotalStake),
                1000,
                "should update next total stake with new rewards"
            )
        })

        it("should checkpoint the caller state", async () => {
            const tx = await bondingManager.connect(transcoder).reward()

            await expectCheckpoints(fixture, tx, {
                account: transcoder.address,
                startRound: currentRound + 2,
                bondedAmount: 1000,
                delegateAddress: transcoder.address,
                delegatedAmount: 2000,
                lastClaimRound: currentRound,
                lastRewardRound: currentRound + 1
            })
        })

        it("should update caller with rewards if lastActiveStakeUpdateRound < currentRound", async () => {
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 3
            )
            const startDelegatedAmount = (
                await bondingManager.getDelegator(transcoder.address)
            )[3]
            const startTotalStake = await bondingManager.transcoderTotalStake(
                transcoder.address
            )
            const startNextTotalStake =
                await bondingManager.nextRoundTotalActiveStake()
            await bondingManager.connect(transcoder).reward()
            const endDelegatedAmount = (
                await bondingManager.getDelegator(transcoder.address)
            )[3]
            const endTotalStake = await bondingManager.transcoderTotalStake(
                transcoder.address
            )
            const endNextTotalStake =
                await bondingManager.nextRoundTotalActiveStake()

            const earningsPool =
                await bondingManager.getTranscoderEarningsPoolForRound(
                    transcoder.address,
                    currentRound + 3
                )
            const expRewardFactor = constants.PERC_DIVISOR_PRECISE.add(
                math.precise.percPoints(
                    BigNumber.from(500),
                    BigNumber.from(1000)
                )
            )
            assert.equal(
                earningsPool.cumulativeRewardFactor.toString(),
                expRewardFactor.toString(),
                "should update cumulativeRewardFactor in earningsPool"
            )

            assert.equal(
                endDelegatedAmount.sub(startDelegatedAmount),
                1000,
                "should update delegatedAmount with new rewards"
            )
            assert.equal(
                endTotalStake.sub(startTotalStake),
                1000,
                "should update transcoder's total stake in the pool with new rewards"
            )
            assert.equal(
                endNextTotalStake.sub(startNextTotalStake),
                1000,
                "should update next total stake with new rewards"
            )
        })

        it("should update caller's pendingStake if lastActiveStakeUpdateRound > currentRound when stake increases before reward call", async () => {
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 3
            )
            // Make sure that lastActiveStakeUpdateRound > currentRound
            await bondingManager
                .connect(nonTranscoder)
                .bond(1000, transcoder.address)
            assert.isAbove(
                (
                    await bondingManager.getTranscoder(transcoder.address)
                ).lastActiveStakeUpdateRound.toNumber(),
                currentRound + 3
            )

            const startPendingStake = await bondingManager.pendingStake(
                transcoder.address,
                currentRound + 3
            )
            await bondingManager.connect(transcoder).reward()
            const endPendingStake = await bondingManager.pendingStake(
                transcoder.address,
                currentRound + 3
            )

            assert.isAbove(
                endPendingStake.toNumber(),
                startPendingStake.toNumber()
            )
        })

        it("should update caller's pendingStake if lastActiveStakeUpdateRound > currentRound when stake decreases before reward call", async () => {
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 3
            )
            // Make sure that lastActiveStakeUpdateRound > currentRound
            await bondingManager.connect(transcoder).unbond(1)
            assert.isAbove(
                (
                    await bondingManager.getTranscoder(transcoder.address)
                ).lastActiveStakeUpdateRound.toNumber(),
                currentRound + 3
            )

            // Since the unbond() above claims earnings before reward is called the following test
            // also checks that the end pendingStake reflects the transcoder still taking its cut
            const startPendingStake = await bondingManager.pendingStake(
                transcoder.address,
                currentRound + 3
            )
            await bondingManager.connect(transcoder).reward()
            const endPendingStake = await bondingManager.pendingStake(
                transcoder.address,
                currentRound + 3
            )

            assert.isAbove(
                endPendingStake.toNumber(),
                startPendingStake.toNumber()
            )
        })

        it("Should emit a Reward event", async () => {
            const txRes = bondingManager.connect(transcoder).reward()
            await expect(txRes)
                .to.emit(bondingManager, "Reward")
                .withArgs(transcoder.address, 1000)
        })

        describe("treasury contribution", () => {
            const TREASURY_CUT = math.precise.percPoints(
                BigNumber.from(631),
                10000
            ) // 6.31%

            beforeEach(async () => {
                await fixture.token.setMockUint256(
                    functionSig("balanceOf(address)"),
                    0
                )

                await bondingManager.setTreasuryRewardCutRate(TREASURY_CUT)
                await bondingManager.setTreasuryBalanceCeiling(1000)

                // treasury cut rate update only takes place on the next round
                await fixture.roundsManager.setMockUint256(
                    functionSig("currentRound()"),
                    currentRound + 1
                )
                await fixture.roundsManager.execute(
                    bondingManager.address,
                    functionSig("setCurrentRoundTotalActiveStake()")
                )
            })

            it("should update caller with rewards after treasury contribution", async () => {
                const startDelegatedAmount = (
                    await bondingManager.getDelegator(transcoder.address)
                )[3]
                const startTotalStake =
                    await bondingManager.transcoderTotalStake(
                        transcoder.address
                    )
                const startNextTotalStake =
                    await bondingManager.nextRoundTotalActiveStake()
                await bondingManager.connect(transcoder).reward()

                const endDelegatedAmount = (
                    await bondingManager.getDelegator(transcoder.address)
                )[3]
                const endTotalStake = await bondingManager.transcoderTotalStake(
                    transcoder.address
                )
                const endNextTotalStake =
                    await bondingManager.nextRoundTotalActiveStake()

                const earningsPool =
                    await bondingManager.getTranscoderEarningsPoolForRound(
                        transcoder.address,
                        currentRound + 1
                    )

                const expRewardFactor = constants.PERC_DIVISOR_PRECISE.add(
                    math.precise.percPoints(
                        BigNumber.from(469), // (1000 - 6.31% = 937) - 50% = 469 (cuts are calculated first and subtracted)
                        BigNumber.from(1000)
                    )
                )
                assert.equal(
                    earningsPool.cumulativeRewardFactor.toString(),
                    expRewardFactor.toString(),
                    "should update cumulativeRewardFactor in earningsPool"
                )

                assert.equal(
                    endDelegatedAmount.sub(startDelegatedAmount),
                    937,
                    "should update delegatedAmount with rewards after treasury cut"
                )
                assert.equal(
                    endTotalStake.sub(startTotalStake),
                    937,
                    "should update transcoder's total stake in the pool with rewards after treasury cut"
                )
                assert.equal(
                    endNextTotalStake.sub(startNextTotalStake),
                    937,
                    "should update next total stake with rewards after treasury cut"
                )
            })

            it("should transfer tokens to the treasury", async () => {
                const tx = await bondingManager.connect(transcoder).reward()

                await expect(tx)
                    .to.emit(fixture.minter, "TrustedTransferTokens")
                    .withArgs(fixture.treasury.address, 63)
            })

            it("should emit TreasuryReward event", async () => {
                const tx = await bondingManager.connect(transcoder).reward()

                await expect(tx)
                    .to.emit(bondingManager, "TreasuryReward")
                    .withArgs(transcoder.address, fixture.treasury.address, 63)
            })

            describe("ceiling behavior", () => {
                describe("under the limit", () => {
                    beforeEach(async () => {
                        await fixture.token.setMockUint256(
                            functionSig("balanceOf(address)"),
                            990
                        )
                    })

                    it("should contribute normally", async () => {
                        const tx = await bondingManager
                            .connect(transcoder)
                            .reward()

                        await expect(tx)
                            .to.emit(fixture.minter, "TrustedTransferTokens")
                            .withArgs(fixture.treasury.address, 63)
                    })

                    it("should not clear treasuryRewardCutRate param", async () => {
                        await bondingManager.connect(transcoder).reward()

                        const cutRate =
                            await bondingManager.treasuryRewardCutRate()
                        assert.equal(
                            cutRate.toString(),
                            TREASURY_CUT.toString(),
                            "cut rate updated"
                        )
                    })
                })

                const atCeilingTest = (title, balance) => {
                    describe(title, () => {
                        beforeEach(async () => {
                            await fixture.token.setMockUint256(
                                functionSig("balanceOf(address)"),
                                balance
                            )
                        })

                        it("should zero the nextRoundTreasuryRewardCutRate", async () => {
                            const tx = await bondingManager
                                .connect(transcoder)
                                .reward()

                            // it should still send treasury rewards
                            await expect(tx).to.emit(
                                fixture.minter,
                                "TrustedTransferTokens"
                            )
                            await expect(tx).to.emit(
                                bondingManager,
                                "TreasuryReward"
                            )

                            await expect(tx)
                                .to.emit(bondingManager, "ParameterUpdate")
                                .withArgs("nextRoundTreasuryRewardCutRate")
                            assert.equal(
                                await bondingManager.nextRoundTreasuryRewardCutRate(),
                                0
                            )
                        })

                        it("should not mint any treasury rewards in the next round", async () => {
                            await bondingManager.connect(transcoder).reward()

                            await fixture.roundsManager.setMockUint256(
                                functionSig("currentRound()"),
                                currentRound + 2
                            )
                            await fixture.roundsManager.execute(
                                bondingManager.address,
                                functionSig("setCurrentRoundTotalActiveStake()")
                            )

                            const tx = await bondingManager
                                .connect(transcoder)
                                .reward()
                            await expect(tx).not.to.emit(
                                fixture.minter,
                                "TrustedTransferTokens"
                            )
                            await expect(tx).not.to.emit(
                                bondingManager,
                                "TreasuryReward"
                            )
                        })

                        it("should also clear treasuryRewardCutRate param in the next round", async () => {
                            await bondingManager.connect(transcoder).reward()

                            await fixture.roundsManager.setMockUint256(
                                functionSig("currentRound()"),
                                currentRound + 2
                            )
                            await fixture.roundsManager.execute(
                                bondingManager.address,
                                functionSig("setCurrentRoundTotalActiveStake()")
                            )

                            const cutRate =
                                await bondingManager.treasuryRewardCutRate()
                            assert.equal(
                                cutRate.toNumber(),
                                0,
                                "cut rate not cleared"
                            )
                        })
                    })
                }

                atCeilingTest("when at limit", 1000)
                atCeilingTest("when above limit", 1500)
            })
        })
    })

    describe("updateTranscoderWithFees", () => {
        let transcoder
        let nonTranscoder
        let currentRound

        beforeEach(async () => {
            transcoder = signers[0]
            nonTranscoder = signers[1]
            currentRound = 100

            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                true
            )
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundLocked()"),
                false
            )
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound
            )

            await bondingManager
                .connect(transcoder)
                .bond(1000, transcoder.address)
            await bondingManager
                .connect(transcoder)
                .transcoder(50 * PERC_MULTIPLIER, 50 * PERC_MULTIPLIER)

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 1
            )
        })

        it("should fail if system is paused", async () => {
            await fixture.controller.pause()

            await expect(
                fixture.ticketBroker.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "updateTranscoderWithFees(address,uint256,uint256)",
                        ["address", "uint256", "uint256"],
                        [transcoder.address, 1000, currentRound + 1]
                    )
                )
            ).to.be.revertedWith("system is paused")
        })

        it("should fail if caller is not TicketBroker", async () => {
            await expect(
                bondingManager.updateTranscoderWithFees(
                    transcoder.address,
                    1000,
                    currentRound + 1
                )
            ).to.be.revertedWith("caller must be TicketBroker")
        })

        it("should fail if transcoder is not registered", async () => {
            await expect(
                fixture.ticketBroker.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "updateTranscoderWithFees(address,uint256,uint256)",
                        ["address", "uint256", "uint256"],
                        [nonTranscoder.address, 1000, currentRound + 1]
                    )
                )
            ).to.be.revertedWith("transcoder must be registered")
        })

        it("should update transcoder's pendingFees when lastActiveStakeUpdateRound > currentRound when stake increases before function call", async () => {
            // Make sure that lastActiveStakeUpdateRound > currentRound
            await bondingManager
                .connect(nonTranscoder)
                .bond(1000, transcoder.address)
            assert.isAbove(
                (
                    await bondingManager.getTranscoder(transcoder.address)
                ).lastActiveStakeUpdateRound.toNumber(),
                currentRound + 1
            )

            const startPendingFees = await bondingManager.pendingFees(
                transcoder.address,
                currentRound + 1
            )

            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder.address, 1000, currentRound + 1]
                )
            )
            const endPendingFees = await bondingManager.pendingFees(
                transcoder.address,
                currentRound + 1
            )

            assert.isAbove(
                endPendingFees.toNumber(),
                startPendingFees.toNumber()
            )
        })

        it("should update transcoder's pendingFees when transcoder claims earnings before fees are generated", async () => {
            await bondingManager
                .connect(transcoder)
                .claimEarnings(currentRound + 1)

            const startPendingFees = await bondingManager.pendingFees(
                transcoder.address,
                currentRound + 1
            )

            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder.address, 1000, currentRound + 1]
                )
            )
            const endPendingFees = await bondingManager.pendingFees(
                transcoder.address,
                currentRound + 1
            )

            assert.isAbove(
                endPendingFees.toNumber(),
                startPendingFees.toNumber()
            )
        })

        it("should update earningsPool cumulativeFeeFactor and transcoder cumulativeFees when transcoder hasn't called reward for current round", async () => {
            // set current cumulativeRewards to 500
            await fixture.minter.setMockUint256(
                functionSig("createReward(uint256,uint256)"),
                1000
            )
            await bondingManager.reward()

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 2
            )

            const tr = await bondingManager.getTranscoder(transcoder.address)
            const cumulativeRewards = tr.cumulativeRewards
            assert.equal(cumulativeRewards.toString(), "500")

            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder.address, 1000, currentRound + 2]
                )
            )

            const earningsPool =
                await bondingManager.getTranscoderEarningsPoolForRound(
                    transcoder.address,
                    currentRound + 2
                )
            assert.equal(
                earningsPool.cumulativeFeeFactor.toString(),
                "375000000000000000000000000",
                "wrong cumulativeFeeFactor"
            )
            assert.equal(
                (
                    await bondingManager.getTranscoder(transcoder.address)
                ).cumulativeFees.toString(),
                "625"
            )
        })

        it("should update transcoder's pendingFees when lastActiveStakeUpdateRound > currentRound when stake decreases before function call", async () => {
            // Make sure that lastActiveStakeUpdateRound > currentRound
            await bondingManager
                .connect(nonTranscoder)
                .bond(1000, transcoder.address)
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 2
            )
            await bondingManager.connect(nonTranscoder).unbond(1)
            assert.isAbove(
                (
                    await bondingManager.getTranscoder(transcoder.address)
                ).lastActiveStakeUpdateRound.toNumber(),
                currentRound + 2
            )

            const startPendingFees = await bondingManager.pendingFees(
                transcoder.address,
                currentRound + 2
            )
            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder.address, 1000, currentRound + 2]
                )
            )
            const endPendingFees = await bondingManager.pendingFees(
                transcoder.address,
                currentRound + 2
            )

            assert.isAbove(
                endPendingFees.toNumber(),
                startPendingFees.toNumber()
            )
        })

        it("should update transcoder cumulativeFees based on cumulativeRewards = 0 and if the transcoder claimed through the current round", async () => {
            // set current cumulativeRewards to 500
            await fixture.minter.setMockUint256(
                functionSig("createReward(uint256,uint256)"),
                1000
            )
            await bondingManager.reward()

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 2
            )
            await bondingManager
                .connect(transcoder)
                .claimEarnings(currentRound + 2)

            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder.address, 1000, currentRound + 2]
                )
            )
            const earningsPool =
                await bondingManager.getTranscoderEarningsPoolForRound(
                    transcoder.address,
                    currentRound + 2
                )
            assert.equal(
                earningsPool.cumulativeFeeFactor.toString(),
                "375000000000000000000000000",
                "wrong cumulativeFeeFactor"
            )
            assert.equal(
                (
                    await bondingManager.getTranscoder(transcoder.address)
                ).cumulativeFees.toString(),
                "500"
            )
        })

        it("should update transcoder's pendingFees when lastActiveStakeUpdateRound < currentRound", async () => {
            // Transcoder's active stake is set for currentRound + 1
            // Transcoder's active is not yet set for currentRound + 2
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 2
            )
            assert.isBelow(
                (
                    await bondingManager.getTranscoder(transcoder.address)
                ).lastActiveStakeUpdateRound.toNumber(),
                currentRound + 2
            )

            const startPendingFees = await bondingManager.pendingFees(
                transcoder.address,
                currentRound + 2
            )

            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder.address, 1000, currentRound + 2]
                )
            )
            const endPendingFees = await bondingManager.pendingFees(
                transcoder.address,
                currentRound + 2
            )

            assert.isAbove(
                endPendingFees.toNumber(),
                startPendingFees.toNumber()
            )
        })

        it("should update earningsPool cumulativeFeeFactor", async () => {
            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder.address, 1000, currentRound + 1]
                )
            )

            const earningsPool =
                await bondingManager.getTranscoderEarningsPoolForRound(
                    transcoder.address,
                    currentRound + 1
                )
            assert.equal(
                earningsPool.cumulativeFeeFactor.toString(),
                "500000000000000000000000000",
                "wrong cumulativeFeeFactor"
            )
        })

        it("should update transcoder with fees", async () => {
            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder.address, 1000, currentRound + 1]
                )
            )

            // set t.cumulativeFees to t.cumulativeFees + fees from fee cut and fees from staked rewards
            const tr = await bondingManager.getTranscoder(signers[0].address)
            assert.equal(
                tr.cumulativeFees.toString(),
                "500",
                "should set transcoder's cumulativeFees to 1000"
            )
        })

        it("should update transcoder lastFeeRound to current round", async () => {
            // We are in currentRound + 1 already
            const round = currentRound + 1

            // Check when the _round param is the current round
            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder.address, 1000, round]
                )
            )
            assert.equal(
                (
                    await bondingManager.getTranscoder(transcoder.address)
                ).lastFeeRound.toNumber(),
                round
            )

            // Check when the _round param is < current round
            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder.address, 1000, round - 1]
                )
            )
            assert.equal(
                (
                    await bondingManager.getTranscoder(transcoder.address)
                ).lastFeeRound.toNumber(),
                round
            )

            // Check when the _round param is > current round
            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder.address, 1000, round + 1]
                )
            )
            assert.equal(
                (
                    await bondingManager.getTranscoder(transcoder.address)
                ).lastFeeRound.toNumber(),
                round
            )
        })
    })

    describe("slashTranscoder", () => {
        let transcoder
        let transcoder1
        let finder
        let nonTranscoder
        let currentRound

        beforeEach(async () => {
            transcoder = signers[0]
            transcoder1 = signers[1]
            finder = signers[2]
            nonTranscoder = signers[3]
            currentRound = 100

            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                true
            )
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundLocked()"),
                false
            )
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound
            )

            await bondingManager
                .connect(transcoder)
                .bond(1000, transcoder.address)
            await bondingManager.connect(transcoder).transcoder(5, 10)

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 1
            )
            await fixture.roundsManager.execute(
                bondingManager.address,
                functionSig("setCurrentRoundTotalActiveStake()")
            )
        })

        it("should fail if system is paused", async () => {
            await fixture.controller.pause()

            await expect(
                fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [
                            transcoder.address,
                            constants.NULL_ADDRESS,
                            PERC_DIVISOR / 2,
                            PERC_DIVISOR / 2
                        ]
                    )
                )
            ).to.be.revertedWith("system is paused")
        })

        it("should fail if caller is not Verifier", async () => {
            await expect(
                bondingManager.slashTranscoder(
                    transcoder.address,
                    constants.NULL_ADDRESS,
                    PERC_DIVISOR / 2,
                    PERC_DIVISOR / 2
                )
            ).to.be.revertedWith("caller must be Verifier")
        })

        it("decreases transcoder's bondedAmount", async () => {
            const startBondedAmount = (
                await bondingManager.getDelegator(transcoder.address)
            )[0].toNumber()
            await fixture.verifier.execute(
                bondingManager.address,
                functionEncodedABI(
                    "slashTranscoder(address,address,uint256,uint256)",
                    ["address", "uint256", "uint256", "uint256"],
                    [
                        transcoder.address,
                        constants.NULL_ADDRESS,
                        PERC_DIVISOR / 2,
                        0
                    ]
                )
            )
            const endBondedAmount = (
                await bondingManager.getDelegator(transcoder.address)
            )[0]

            assert.equal(
                endBondedAmount,
                startBondedAmount / 2,
                "should decrease transcoder's bondedAmount by slashAmount"
            )
        })

        it("should checkpoint the transcoder state", async () => {
            // make sure trancoder has a non-null `lastRewardRound`
            await bondingManager.connect(transcoder).reward()

            const startBondedAmount = (
                await bondingManager.getDelegator(transcoder.address)
            )[0].toNumber()
            const tx = await fixture.verifier.execute(
                bondingManager.address,
                functionEncodedABI(
                    "slashTranscoder(address,address,uint256,uint256)",
                    ["address", "uint256", "uint256", "uint256"],
                    [
                        transcoder.address,
                        constants.NULL_ADDRESS,
                        PERC_DIVISOR / 2,
                        0
                    ]
                )
            )

            await expectCheckpoints(fixture, tx, {
                account: transcoder.address,
                startRound: currentRound + 2,
                bondedAmount: startBondedAmount / 2,
                delegateAddress: transcoder.address,
                delegatedAmount: startBondedAmount / 2,
                lastClaimRound: currentRound + 1,
                lastRewardRound: currentRound + 1
            })
        })

        describe("transcoder is bonded", () => {
            it("updates delegated amount and next total stake tokens", async () => {
                const startNextTotalStake =
                    await bondingManager.nextRoundTotalActiveStake()
                await fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [
                            transcoder.address,
                            constants.NULL_ADDRESS,
                            PERC_DIVISOR / 2,
                            0
                        ]
                    )
                )
                const endNextTotalStake =
                    await bondingManager.nextRoundTotalActiveStake()

                assert.equal(
                    (await bondingManager.getDelegator(transcoder.address))[3],
                    500,
                    "should decrease delegatedAmount for transcoder by slash amount"
                )
                assert.equal(
                    startNextTotalStake.sub(endNextTotalStake),
                    1000,
                    "should decrease next total stake tokens by transcoder's delegated stake"
                )
            })
        })

        describe("transcoder has an unbonding lock", () => {
            beforeEach(async () => {
                await bondingManager.connect(transcoder).unbond(500)
            })

            it("still decreases transcoder's bondedAmount", async () => {
                const startBondedAmount = (
                    await bondingManager.getDelegator(transcoder.address)
                )[0].toNumber()
                await fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [
                            transcoder.address,
                            constants.NULL_ADDRESS,
                            PERC_DIVISOR / 2,
                            0
                        ]
                    )
                )
                const endBondedAmount = (
                    await bondingManager.getDelegator(transcoder.address)
                )[0]

                assert.equal(
                    endBondedAmount,
                    startBondedAmount / 2,
                    "should decrease transcoder's bondedAmount by slashAmount"
                )
            })
        })

        describe("transcoder is active", () => {
            it("transcoder remains active until the next round", async () => {
                await fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [
                            transcoder.address,
                            constants.NULL_ADDRESS,
                            PERC_DIVISOR / 2,
                            0
                        ]
                    )
                )
                assert.isOk(
                    await bondingManager.isActiveTranscoder(transcoder.address),
                    "should set active transcoder as inactive for the round"
                )
            })

            it("deducts the transcoder's stake from the total for the next round", async () => {
                const startTotalActiveStake =
                    await bondingManager.nextRoundTotalActiveStake()
                await fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [
                            transcoder.address,
                            constants.NULL_ADDRESS,
                            PERC_DIVISOR / 2,
                            0
                        ]
                    )
                )
                const endTotalActiveStake =
                    await bondingManager.nextRoundTotalActiveStake()
                assert.equal(
                    startTotalActiveStake.sub(endTotalActiveStake).toNumber(),
                    1000,
                    "should decrease total active stake by total stake of transcoder"
                )
            })

            it("sets the transcoder's deactivation round to next round", async () => {
                await fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [
                            transcoder.address,
                            constants.NULL_ADDRESS,
                            PERC_DIVISOR / 2,
                            0
                        ]
                    )
                )
                assert.equal(
                    (await bondingManager.getTranscoder(transcoder.address))
                        .deactivationRound,
                    currentRound + 2
                )
            })

            it("fires a TranscoderDeactivated event", async () => {
                const txRes = fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [
                            transcoder.address,
                            constants.NULL_ADDRESS,
                            PERC_DIVISOR / 2,
                            0
                        ]
                    )
                )
                await expect(txRes)
                    .to.emit(bondingManager, "TranscoderDeactivated")
                    .withArgs(transcoder.address, currentRound + 2)
            })
        })

        describe("transcoder is not active but is in pool", () => {
            beforeEach(async () => {
                await bondingManager
                    .connect(transcoder1)
                    .bond(2000, transcoder1.address)
                await bondingManager.connect(transcoder1).transcoder(5, 10)
            })

            it("still decreases transcoder's bondedAmount", async () => {
                const startBondedAmount = (
                    await bondingManager.getDelegator(transcoder1.address)
                )[0]
                await fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [
                            transcoder1.address,
                            constants.NULL_ADDRESS,
                            PERC_DIVISOR / 2,
                            0
                        ]
                    )
                )
                const endBondedAmount = (
                    await bondingManager.getDelegator(transcoder1.address)
                )[0]

                assert.equal(
                    endBondedAmount,
                    startBondedAmount / 2,
                    "should decrease transcoder's bondedAmount by slashAmount"
                )
            })

            it("decreases the total active stake for the next round", async () => {
                const startTotalActiveStake =
                    await bondingManager.nextRoundTotalActiveStake()
                await fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [
                            transcoder1.address,
                            constants.NULL_ADDRESS,
                            PERC_DIVISOR / 2,
                            0
                        ]
                    )
                )
                const endTotalActiveStake =
                    await bondingManager.nextRoundTotalActiveStake()
                assert.equal(
                    startTotalActiveStake.sub(endTotalActiveStake).toNumber(),
                    2000,
                    "should decrease total active stake by total stake of transcoder"
                )
            })
        })

        describe("transcoder is registered but not in pool", () => {
            beforeEach(async () => {
                await bondingManager
                    .connect(transcoder1)
                    .bond(2000, transcoder1.address)
                await bondingManager
                    .connect(nonTranscoder)
                    .bond(100, nonTranscoder.address)
            })
            it("still decreases transcoder's bondedAmount", async () => {
                const startBondedAmount = (
                    await bondingManager.getDelegator(nonTranscoder.address)
                )[0]
                await fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [
                            nonTranscoder.address,
                            constants.NULL_ADDRESS,
                            PERC_DIVISOR / 2,
                            0
                        ]
                    )
                )
                const endBondedAmount = (
                    await bondingManager.getDelegator(nonTranscoder.address)
                )[0]

                assert.equal(
                    endBondedAmount,
                    startBondedAmount / 2,
                    "should decrease transcoder's bondedAmount by slashAmount"
                )
            })

            it("doesn't change the total for the next round", async () => {
                const startTotalActiveStake =
                    await bondingManager.nextRoundTotalActiveStake()
                await fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [
                            nonTranscoder.address,
                            constants.NULL_ADDRESS,
                            PERC_DIVISOR / 2,
                            0
                        ]
                    )
                )
                const endTotalActiveStake =
                    await bondingManager.nextRoundTotalActiveStake()
                assert.equal(
                    startTotalActiveStake.sub(endTotalActiveStake).toNumber(),
                    0,
                    "should decrease total active stake by total stake of transcoder"
                )
            })
        })

        describe("invoked with a finder", () => {
            it("slashes transcoder and rewards finder", async () => {
                const txRes = fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [
                            transcoder.address,
                            finder.address,
                            PERC_DIVISOR / 2,
                            PERC_DIVISOR / 2
                        ]
                    )
                )

                await expect(txRes)
                    .to.emit(bondingManager, "TranscoderSlashed")
                    .withArgs(transcoder.address, finder.address, 500, 250)
            })
        })

        describe("invoked without a finder", () => {
            it("slashes transcoder", async () => {
                const txRes = fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [
                            transcoder.address,
                            constants.NULL_ADDRESS,
                            PERC_DIVISOR / 2,
                            0
                        ]
                    )
                )

                await expect(txRes)
                    .to.emit(bondingManager, "TranscoderSlashed")
                    .withArgs(
                        transcoder.address,
                        constants.NULL_ADDRESS,
                        500,
                        0
                    )
            })
        })

        describe("transcoder no longer has a bonded amount", () => {
            beforeEach(async () => {
                await bondingManager.connect(transcoder).unbond(1000)
                const unbondingPeriod =
                    await bondingManager.unbondingPeriod.call()
                await fixture.roundsManager.setMockUint256(
                    functionSig("currentRound()"),
                    currentRound + 1 + unbondingPeriod.toNumber()
                )
                await bondingManager.connect(transcoder).withdrawStake(0)
            })

            it("fires a TranscoderSlashed event, but transcoder is not penalized because it does not have a bonded amount", async () => {
                const txRes = fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [
                            transcoder.address,
                            constants.NULL_ADDRESS,
                            PERC_DIVISOR / 2,
                            0
                        ]
                    )
                )

                await expect(txRes)
                    .to.emit(bondingManager, "TranscoderSlashed")
                    .withArgs(transcoder.address, constants.NULL_ADDRESS, 0, 0)
            })
        })
    })

    describe("claimEarnings", () => {
        let transcoder
        let delegator1
        let delegator2
        let delegator3
        let currentRound

        let transcoderRewards
        let transcoderFees
        let delegatorRewards
        let delegatorFees

        beforeEach(async () => {
            transcoder = signers[0]
            delegator1 = signers[1]
            delegator2 = signers[2]
            delegator3 = signers[3]
            currentRound = 100

            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                true
            )
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundLocked()"),
                false
            )
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound - 1
            )

            await bondingManager
                .connect(transcoder)
                .bond(1000, transcoder.address)
            await bondingManager
                .connect(transcoder)
                .transcoder(50 * PERC_MULTIPLIER, 25 * PERC_MULTIPLIER)
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound
            )
            await bondingManager
                .connect(delegator1)
                .bond(3000, transcoder.address)
            await bondingManager
                .connect(delegator2)
                .bond(3000, transcoder.address)
            await bondingManager
                .connect(delegator3)
                .bond(3000, transcoder.address)
            await fixture.roundsManager.execute(
                bondingManager.address,
                functionSig("setCurrentRoundTotalActiveStake()")
            )

            transcoderRewards = Math.floor(1000 * 0.5)
            transcoderFees = Math.floor(1000 * 0.75)
            delegatorRewards = 1000 - transcoderRewards
            delegatorFees = 1000 - transcoderFees

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 1
            )
            await fixture.minter.setMockUint256(
                functionSig("createReward(uint256,uint256)"),
                1000
            )
            await bondingManager.connect(transcoder).reward()

            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder.address, 1000, currentRound + 1]
                )
            )
        })

        it("should fail if system is paused", async () => {
            await fixture.controller.pause()

            await expect(
                bondingManager
                    .connect(delegator1)
                    .claimEarnings(currentRound + 1)
            ).to.be.revertedWith("system is paused")
        })

        it("should fail if current round is not initialized", async () => {
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                false
            )

            await expect(
                bondingManager
                    .connect(delegator1)
                    .claimEarnings(currentRound + 1)
            ).to.be.revertedWith("current round is not initialized")
        })

        it("updates caller's lastClaimRound", async () => {
            await bondingManager
                .connect(delegator1)
                .claimEarnings(currentRound + 1)

            assert.equal(
                (await bondingManager.getDelegator(delegator1.address))[5],
                currentRound + 1,
                "should update caller's lastClaimRound to the current round"
            )
        })

        it("should checkpoint the caller state", async () => {
            const tx = await bondingManager
                .connect(delegator1)
                .claimEarnings(currentRound + 1)

            await expectCheckpoints(fixture, tx, {
                account: delegator1.address,
                startRound: currentRound + 2,
                bondedAmount:
                    3000 + Math.floor((delegatorRewards * 3000) / 10000),
                delegateAddress: transcoder.address,
                delegatedAmount: 0,
                lastClaimRound: currentRound + 1,
                lastRewardRound: 0
            })
        })

        it("updates transcoders cumulativeRewardFactor for _endRound EarningsPool if reward is not called for _endRound yet", async () => {
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 2
            )

            await bondingManager
                .connect(delegator1)
                .claimEarnings(currentRound + 2)

            assert.equal(
                (
                    await bondingManager.getTranscoderEarningsPoolForRound(
                        transcoder.address,
                        currentRound + 2
                    )
                ).cumulativeRewardFactor.toString(),
                (
                    await bondingManager.getTranscoderEarningsPoolForRound(
                        transcoder.address,
                        currentRound + 1
                    )
                ).cumulativeRewardFactor
            )
        })

        it("updates transcoders cumulativeFeeFactor for _endRound EarningsPool if no fees for _endRound yet", async () => {
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 2
            )

            await bondingManager
                .connect(delegator1)
                .claimEarnings(currentRound + 2)

            assert.equal(
                (
                    await bondingManager.getTranscoderEarningsPoolForRound(
                        transcoder.address,
                        currentRound + 2
                    )
                ).cumulativeFeeFactor.toString(),
                (
                    await bondingManager.getTranscoderEarningsPoolForRound(
                        transcoder.address,
                        currentRound + 1
                    )
                ).cumulativeFeeFactor
            )
        })

        it("does not update transcoder cumulativeRewardFactor for _endRound EarningsPool if lastRewardRound is in the future", async () => {
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 3
            )

            await bondingManager.connect(transcoder).reward()

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 2
            )

            await bondingManager
                .connect(delegator1)
                .claimEarnings(currentRound + 2)

            const lastRewardRound = (
                await bondingManager.getTranscoder(transcoder.address)
            ).lastRewardRound
            assert.equal(lastRewardRound.toNumber(), currentRound + 3)
            assert.notEqual(
                (
                    await bondingManager.getTranscoderEarningsPoolForRound(
                        transcoder.address,
                        lastRewardRound
                    )
                ).cumulativeRewardFactor.toString(),
                "0"
            )
            assert.equal(
                (
                    await bondingManager.getTranscoderEarningsPoolForRound(
                        transcoder.address,
                        currentRound + 2
                    )
                ).cumulativeRewardFactor.toString(),
                "0"
            )
        })

        it("does not update transcoder cumulativeFeeFactor for _endRound EarningsPool if lastFeeRound is in the future", async () => {
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 3
            )

            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder.address, 1000, currentRound + 3]
                )
            )

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 2
            )

            await bondingManager
                .connect(delegator1)
                .claimEarnings(currentRound + 2)

            const lastFeeRound = (
                await bondingManager.getTranscoder(transcoder.address)
            ).lastFeeRound
            assert.equal(lastFeeRound.toNumber(), currentRound + 3)
            assert.notEqual(
                (
                    await bondingManager.getTranscoderEarningsPoolForRound(
                        transcoder.address,
                        lastFeeRound
                    )
                ).cumulativeFeeFactor.toString(),
                "0"
            )
            assert.equal(
                (
                    await bondingManager.getTranscoderEarningsPoolForRound(
                        transcoder.address,
                        currentRound + 2
                    )
                ).cumulativeFeeFactor.toString(),
                "0"
            )
        })

        it("fires an EarningsClaimed event", async () => {
            const expRewards = BigNumber.from(delegatorRewards * 0.3) // 30%
            const expFees = BigNumber.from(delegatorFees * 0.3) // 30%
            const acceptableDelta = 5
            const fromBlock = await ethers.provider.getBlockNumber()
            await bondingManager
                .connect(delegator1)
                .claimEarnings(currentRound + 1)

            const filter = await bondingManager.filters.EarningsClaimed(
                transcoder.address,
                delegator1.address
            )
            const events = await bondingManager.queryFilter(
                filter,
                fromBlock,
                "latest"
            )
            const [t, del, rewards, fees, start, end] = events[0].args

            assert.equal(t, transcoder.address)
            assert.equal(del, delegator1.address)
            assert.isAtMost(
                fees.sub(expFees.toString()),
                ethers.BigNumber.from(acceptableDelta)
            )
            assert.equal(rewards, expRewards.toString())
            assert.equal(start, (currentRound + 1).toString())
            assert.equal(end, (currentRound + 1).toString())
        })

        describe("caller has a delegate", () => {
            it("should claim earnings for 1 round", async () => {
                const expRewards = BigNumber.from(delegatorRewards * 0.3) // 30%
                const expFees = BigNumber.from(delegatorFees * 0.3) // 30%
                const acceptableDelta = 5

                const startDInfo1 = await bondingManager.getDelegator(
                    delegator1.address
                )
                await bondingManager
                    .connect(delegator1)
                    .claimEarnings(currentRound + 1)
                const endDInfo1 = await bondingManager.getDelegator(
                    delegator1.address
                )
                const d1Rewards = endDInfo1[0].sub(startDInfo1[0])
                const d1Fees = endDInfo1[1].sub(startDInfo1[1])

                const startDInfo2 = await bondingManager.getDelegator(
                    delegator2.address
                )
                await bondingManager
                    .connect(delegator2)
                    .claimEarnings(currentRound + 1)
                const endDInfo2 = await bondingManager.getDelegator(
                    delegator2.address
                )
                const d2Rewards = endDInfo2[0].sub(startDInfo2[0])
                const d2Fees = endDInfo2[1].sub(startDInfo2[1])

                const startDInfo3 = await bondingManager.getDelegator(
                    delegator3.address
                )
                await bondingManager
                    .connect(delegator3)
                    .claimEarnings(currentRound + 1)
                const endDInfo3 = await bondingManager.getDelegator(
                    delegator3.address
                )
                const d3Rewards = endDInfo3[0].sub(startDInfo3[0])
                const d3Fees = endDInfo3[1].sub(startDInfo3[1])

                assert.isAtMost(
                    d1Rewards.sub(d2Rewards).abs().toNumber(),
                    acceptableDelta
                )
                assert.isAtMost(
                    d1Rewards.sub(d3Rewards).abs().toNumber(),
                    acceptableDelta
                )
                assert.isAtMost(
                    d2Rewards.sub(d3Rewards).abs().toNumber(),
                    acceptableDelta
                )
                assert.isAtMost(
                    d1Fees.sub(d2Fees).abs().toNumber(),
                    acceptableDelta
                )
                assert.isAtMost(
                    d1Fees.sub(d3Fees).abs().toNumber(),
                    acceptableDelta
                )
                assert.isAtMost(
                    d2Fees.sub(d3Fees).abs().toNumber(),
                    acceptableDelta
                )
                assert.isAtMost(
                    d1Rewards.sub(expRewards.toString()).abs().toNumber(),
                    acceptableDelta
                )
                assert.isAtMost(
                    d2Rewards.sub(expRewards.toString()).abs().toNumber(),
                    acceptableDelta
                )
                assert.isAtMost(
                    d3Rewards.sub(expRewards.toString()).abs().toNumber(),
                    acceptableDelta
                )
                assert.isAtMost(
                    d1Fees.sub(expFees.toString()).abs().toNumber(),
                    acceptableDelta
                )
                assert.isAtMost(
                    d2Fees.sub(expFees.toString()).abs().toNumber(),
                    acceptableDelta
                )
                assert.isAtMost(
                    d3Fees.sub(expFees.toString()).abs().toNumber(),
                    acceptableDelta
                )
            })

            it("should claim earnings for > 1 round", async () => {
                const expRewardsFirstRound = delegatorRewards * 0.3 // 30%
                const expFeesFirstRound = delegatorFees * 0.3 // 30%
                // After first round, the expected distribution is:
                // T1 = 1000 + 500 + 50 = 1550 (~14.1%)
                // D1 = 3000 + 150 = 3150 (~28.6%)
                // D2 = 3000 + 150 = 3150 (~28.6%)
                // D2 = 3000 + 150 = 3150 (~28.6%)
                // Total = 11000
                const expRewardsSecondRound = Math.floor(
                    delegatorRewards * 0.286
                ) // 28.6%
                const expFeesSecondRound = Math.floor(delegatorFees * 0.286) // 28.6%
                const expRewards = BigNumber.from(
                    expRewardsFirstRound + expRewardsSecondRound
                )
                const expFees = BigNumber.from(
                    expFeesFirstRound + expFeesSecondRound
                )
                const acceptableDelta = 5

                await fixture.roundsManager.setMockUint256(
                    functionSig("currentRound()"),
                    currentRound + 2
                )
                await fixture.minter.setMockUint256(
                    functionSig("createReward(uint256,uint256)"),
                    1000
                )
                await bondingManager.connect(transcoder).reward()
                await fixture.ticketBroker.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "updateTranscoderWithFees(address,uint256,uint256)",
                        ["address", "uint256", "uint256"],
                        [transcoder.address, 1000, currentRound + 2]
                    )
                )

                const startDInfo1 = await bondingManager.getDelegator(
                    delegator1.address
                )
                await bondingManager
                    .connect(delegator1)
                    .claimEarnings(currentRound + 2)
                const endDInfo1 = await bondingManager.getDelegator(
                    delegator1.address
                )
                const d1Rewards = endDInfo1[0].sub(startDInfo1[0])
                const d1Fees = endDInfo1[1].sub(startDInfo1[1])

                const startDInfo2 = await bondingManager.getDelegator(
                    delegator2.address
                )
                await bondingManager
                    .connect(delegator2)
                    .claimEarnings(currentRound + 2)
                const endDInfo2 = await bondingManager.getDelegator(
                    delegator2.address
                )
                const d2Rewards = endDInfo2[0].sub(startDInfo2[0])
                const d2Fees = endDInfo2[1].sub(startDInfo2[1])

                const startDInfo3 = await bondingManager.getDelegator(
                    delegator3.address
                )
                await bondingManager
                    .connect(delegator3)
                    .claimEarnings(currentRound + 2)
                const endDInfo3 = await bondingManager.getDelegator(
                    delegator3.address
                )
                const d3Rewards = endDInfo3[0].sub(startDInfo3[0])
                const d3Fees = endDInfo3[1].sub(startDInfo3[1])

                assert.isAtMost(
                    d1Rewards.sub(d2Rewards).abs().toNumber(),
                    acceptableDelta
                )
                assert.isAtMost(
                    d1Rewards.sub(d3Rewards).abs().toNumber(),
                    acceptableDelta
                )
                assert.isAtMost(
                    d2Rewards.sub(d3Rewards).abs().toNumber(),
                    acceptableDelta
                )
                assert.isAtMost(
                    d1Fees.sub(d2Fees).abs().toNumber(),
                    acceptableDelta
                )
                assert.isAtMost(
                    d1Fees.sub(d3Fees).abs().toNumber(),
                    acceptableDelta
                )
                assert.isAtMost(
                    d2Fees.sub(d3Fees).abs().toNumber(),
                    acceptableDelta
                )
                assert.isAtMost(
                    d1Rewards.sub(expRewards.toString()).abs().toNumber(),
                    acceptableDelta
                )
                assert.isAtMost(
                    d2Rewards.sub(expRewards.toString()).abs().toNumber(),
                    acceptableDelta
                )
                assert.isAtMost(
                    d3Rewards.sub(expRewards.toString()).abs().toNumber(),
                    acceptableDelta
                )
                assert.isAtMost(
                    d1Fees.sub(expFees.toString()).abs().toNumber(),
                    acceptableDelta
                )
                assert.isAtMost(
                    d2Fees.sub(expFees.toString()).abs().toNumber(),
                    acceptableDelta
                )
                assert.isAtMost(
                    d3Fees.sub(expFees.toString()).abs().toNumber(),
                    acceptableDelta
                )
            })

            describe("caller is a transcoder", () => {
                it("should claim earnings as both a delegator and a transcoder", async () => {
                    const expDelegatorRewards = delegatorRewards * 0.1 // 10%
                    const expRewards = BigNumber.from(
                        expDelegatorRewards + transcoderRewards
                    )
                    const expDelegatorFees = delegatorFees * 0.1
                    const expFees = BigNumber.from(
                        expDelegatorFees + transcoderFees
                    )
                    const acceptableDelta = 5

                    const startDInfo = await bondingManager.getDelegator(
                        transcoder.address
                    )
                    await bondingManager
                        .connect(transcoder)
                        .claimEarnings(currentRound + 1)
                    const endDInfo = await bondingManager.getDelegator(
                        transcoder.address
                    )
                    const tRewards = endDInfo[0].sub(startDInfo[0])
                    const tFees = endDInfo[1].sub(startDInfo[1])

                    assert.isAtMost(
                        tRewards.sub(expRewards.toString()).abs().toNumber(),
                        acceptableDelta
                    )
                    assert.isAtMost(
                        tFees.sub(expFees.toString()).abs().toNumber(),
                        acceptableDelta
                    )
                })

                it("should claim earnings as both a delegator and a transcoder regardless of when other delegators claim", async () => {
                    const expDelegatorRewards = delegatorRewards * 0.1 // 10%
                    const expRewards = BigNumber.from(
                        expDelegatorRewards + transcoderRewards
                    )
                    const expDelegatorFees = delegatorFees * 0.1
                    const expFees = BigNumber.from(
                        expDelegatorFees + transcoderFees
                    )
                    const acceptableDelta = 5

                    await bondingManager
                        .connect(delegator1)
                        .claimEarnings(currentRound + 1)
                    await bondingManager
                        .connect(delegator2)
                        .claimEarnings(currentRound + 1)

                    const startDInfo = await bondingManager.getDelegator(
                        transcoder.address
                    )
                    await bondingManager
                        .connect(transcoder)
                        .claimEarnings(currentRound + 1)
                    const endDInfo = await bondingManager.getDelegator(
                        transcoder.address
                    )
                    const tRewards = endDInfo[0].sub(startDInfo[0])
                    const tFees = endDInfo[1].sub(startDInfo[1])

                    assert.isAtMost(
                        tRewards.sub(expRewards.toString()).abs().toNumber(),
                        acceptableDelta
                    )
                    assert.isAtMost(
                        tFees.sub(expFees.toString()).abs().toNumber(),
                        acceptableDelta
                    )
                })
            })
        })
    })

    describe("pendingStake", () => {
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
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound - 2
            )

            await bondingManager
                .connect(transcoder)
                .bond(1000, transcoder.address)
            await bondingManager
                .connect(transcoder)
                .transcoder(50 * PERC_MULTIPLIER, 25 * PERC_MULTIPLIER)
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound - 1
            )
            await bondingManager
                .connect(delegator)
                .bond(1000, transcoder.address)
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound
            )

            await fixture.minter.setMockUint256(
                functionSig("createReward(uint256,uint256)"),
                1000
            )
            await bondingManager.connect(transcoder).reward()

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 1
            )

            await bondingManager.connect(transcoder).reward()
        })

        it("should return pending rewards for all rounds since lastClaimRound", async () => {
            const pendingRewards0 = 250
            const pendingRewards1 = Math.floor(
                (500 * ((1250 * PERC_DIVISOR) / 3000)) / PERC_DIVISOR
            )

            const ps = await bondingManager.pendingStake(
                delegator.address,
                currentRound + 1
            )
            assert.equal(
                ps.toString(),
                1000 + pendingRewards0 + pendingRewards1,
                "should return sum of bondedAmount and pending rewards for 2 rounds"
            )
            // When endRound > currentRound
            assert.equal(
                ps.toString(),
                (
                    await bondingManager.pendingStake(
                        delegator.address,
                        currentRound + 2
                    )
                ).toString()
            )
            // When endRound < currentRound
            assert.equal(
                ps.toString(),
                (
                    await bondingManager.pendingStake(
                        delegator.address,
                        currentRound
                    )
                ).toString()
            )
        })

        it("should return delegator.bondedAmount when endRound < lastClaimRound", async () => {
            await bondingManager
                .connect(delegator)
                .claimEarnings(currentRound + 1)

            const bondedAmount = (
                await bondingManager.getDelegator(delegator.address)
            ).bondedAmount
            assert.equal(
                (
                    await bondingManager.pendingStake(
                        delegator.address,
                        currentRound
                    )
                ).toString(),
                bondedAmount.toString()
            )
        })

        it("should return delegator.bondedAmount when endRound = lastClaimRound", async () => {
            await bondingManager
                .connect(delegator)
                .claimEarnings(currentRound + 1)

            const bondedAmount = (
                await bondingManager.getDelegator(delegator.address)
            ).bondedAmount
            assert.equal(
                (
                    await bondingManager.pendingStake(
                        delegator.address,
                        currentRound + 1
                    )
                ).toString(),
                bondedAmount.toString()
            )
        })

        it("should return pending rewards through lastRewardRound if transcoder hasn't called reward for the end round", async () => {
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 2
            )

            const pendingRewards0 = 250
            const pendingRewards1 = Math.floor(
                (500 * ((1250 * PERC_DIVISOR) / 3000)) / PERC_DIVISOR
            )

            assert.equal(
                (
                    await bondingManager.pendingStake(
                        delegator.address,
                        currentRound + 2
                    )
                ).toString(),
                (1000 + pendingRewards0 + pendingRewards1).toString()
            )
        })

        it("should return pending rewards even if transcoder hasn't called reward for it's lastClaimRound", async () => {
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 2
            )

            await bondingManager
                .connect(delegator)
                .claimEarnings(currentRound + 2)

            const pendingRewards0 = 250
            const pendingRewards1 = Math.floor(
                (500 * ((1250 * PERC_DIVISOR) / 3000)) / PERC_DIVISOR
            )
            const pendingRewards2 = Math.floor(
                (500 *
                    (((1000 + pendingRewards0 + pendingRewards1) *
                        PERC_DIVISOR) /
                        4000)) /
                    PERC_DIVISOR
            )
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 3
            )

            await bondingManager.connect(transcoder).reward()

            assert.equal(
                (
                    await bondingManager.pendingStake(
                        delegator.address,
                        currentRound + 3
                    )
                ).toNumber(),
                1000 + pendingRewards0 + pendingRewards1 + pendingRewards2
            )
        })

        describe("no rewards since last claim round", async () => {
            const bondedAmount =
                1000 +
                250 +
                Math.floor(
                    (500 * ((1250 * PERC_DIVISOR) / 3000)) / PERC_DIVISOR
                )

            beforeEach(async () => {
                await bondingManager
                    .connect(delegator)
                    .claimEarnings(currentRound + 1)

                await fixture.roundsManager.setMockUint256(
                    functionSig("currentRound()"),
                    currentRound + 2
                )
            })

            it("should return bondedAmount when transcoder.lastRewardRound < delegator.lastClaimRound", async () => {
                // Claim rewards through currentRound + 2
                await bondingManager
                    .connect(delegator)
                    .claimEarnings(currentRound + 2)

                await fixture.roundsManager.setMockUint256(
                    functionSig("currentRound()"),
                    currentRound + 3
                )
                // The transcoder's pool has claimableStake = 0 for currentRound + 3 because the transcoder did not call reward()
                // in currentRound + 2 so it did not update the claimableStake in its pool for currentRound + 3
                assert.equal(
                    (
                        await bondingManager.pendingStake(
                            delegator.address,
                            currentRound + 3
                        )
                    ).toNumber(),
                    bondedAmount
                )
            })
        })

        describe("delegator is a transcoder", () => {
            it("should return pending rewards as both a delegator and a transcoder", async () => {
                const cumulativeRewards = (
                    await bondingManager.getTranscoder(transcoder.address)
                ).cumulativeRewards.toNumber()
                const pendingRewards =
                    250 +
                    Math.floor(
                        (500 * ((1250 * PERC_DIVISOR) / 3000)) / PERC_DIVISOR
                    ) +
                    cumulativeRewards

                assert.equal(
                    (
                        await bondingManager.pendingStake(
                            transcoder.address,
                            currentRound
                        )
                    ).toNumber(),
                    1000 + pendingRewards,
                    "should return sum of bondedAmount and pending rewards as both a delegator and transcoder for 2 rounds"
                )
            })
        })
    })

    describe("pendingFees", () => {
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
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound - 1
            )

            const iface = (await ethers.getContractFactory("RoundsManager"))
                .interface
            const fnName = "lipUpgradeRound(uint256)"
            await fixture.roundsManager.setMockUint256WithParam(
                functionSig(fnName),
                ethers.utils.solidityKeccak256(
                    ["bytes"],
                    [iface.encodeFunctionData(fnName, [71])]
                ),
                currentRound + 3
            )

            await bondingManager
                .connect(transcoder)
                .bond(1000, transcoder.address)
            await bondingManager
                .connect(transcoder)
                .transcoder(50 * PERC_MULTIPLIER, 25 * PERC_MULTIPLIER)
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound
            )
            await bondingManager
                .connect(delegator)
                .bond(1000, transcoder.address)

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 1
            )
            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder.address, 1000, currentRound + 1]
                )
            )
            await fixture.minter.setMockUint256(
                functionSig("createReward(uint256,uint256)"),
                1000
            )
            await bondingManager.connect(transcoder).reward()

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 2
            )
            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder.address, 1000, currentRound + 2]
                )
            )

            await bondingManager.connect(transcoder).reward()
        })

        it("should return pending fees for all rounds since lastClaimRound when endRound < currentRound and endRound > LIP-36 upgrade round", async () => {
            const pendingFees0 = 125
            const pendingFees1 = Math.floor(
                (250 * ((1250 * PERC_DIVISOR) / 3000)) / PERC_DIVISOR
            )

            const pf = await bondingManager.pendingFees(
                delegator.address,
                currentRound + 1
            )
            assert.equal(
                pf.toString(),
                pendingFees0 + pendingFees1,
                "should return sum of collected fees and pending fees for 2 rounds"
            )
            assert.equal(
                pf.toString(),
                (
                    await bondingManager.pendingFees(
                        delegator.address,
                        currentRound + 2
                    )
                ).toString()
            )
        })

        it("should return pending fees for all rounds since lastClaimRound when endRound == currentRound and endRound > LIP-36 upgrade round", async () => {
            const pendingFees0 = 125
            const pendingFees1 = Math.floor(
                (250 * ((1250 * PERC_DIVISOR) / 3000)) / PERC_DIVISOR
            )

            assert.equal(
                (
                    await bondingManager.pendingFees(
                        delegator.address,
                        currentRound + 2
                    )
                ).toNumber(),
                pendingFees0 + pendingFees1,
                "should return sum of collected fees and pending fees for 2 rounds"
            )
        })

        it("should return pending fees for all rounds since lastClaimRound when endRound == LIP-36 upgrade round", async () => {
            const iface = (await ethers.getContractFactory("RoundsManager"))
                .interface
            const fnName = "lipUpgradeRound(uint256)"
            await fixture.roundsManager.setMockUint256WithParam(
                functionSig(fnName),
                ethers.utils.solidityKeccak256(
                    ["bytes"],
                    [iface.encodeFunctionData(fnName, [36])]
                ),
                currentRound + 1
            )

            const pendingFees0 = 125
            const pendingFees1 = Math.floor(
                (250 * ((1250 * PERC_DIVISOR) / 3000)) / PERC_DIVISOR
            )

            const pf = await bondingManager.pendingFees(
                delegator.address,
                currentRound + 1
            )
            assert.equal(pf.toString(), pendingFees0 + pendingFees1)
            assert.equal(
                pf.toString(),
                (
                    await bondingManager.pendingFees(
                        delegator.address,
                        currentRound + 2
                    )
                ).toString()
            )
        })

        it("should return pending fees for > 1 round when endRound > currentRound", async () => {
            const pendingFees0 = 125
            const pendingFees1 = Math.floor(
                (250 * ((1250 * PERC_DIVISOR) / 3000)) / PERC_DIVISOR
            )

            assert.equal(
                (
                    await bondingManager.pendingFees(
                        delegator.address,
                        currentRound + 3
                    )
                ).toString(),
                (pendingFees0 + pendingFees1).toString()
            )
        })

        it("should return pending fees when transcoder hasn't called reward since the previous round", async () => {
            const pendingFees0 = 125
            const pendingFees1 = Math.floor(
                (250 * ((1250 * PERC_DIVISOR) / 3000)) / PERC_DIVISOR
            )
            const pendingFees2 = Math.floor(
                (250 * ((1458 * PERC_DIVISOR) / 4000)) / PERC_DIVISOR
            )

            await bondingManager
                .connect(delegator)
                .claimEarnings(currentRound + 2)
            const fees = (await bondingManager.getDelegator(delegator.address))
                .fees
            assert.equal(
                pendingFees0 + pendingFees1,
                fees.toNumber(),
                "delegator fees not correct"
            )

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 3
            )

            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder.address, 1000, currentRound + 3]
                )
            )

            assert.equal(
                (
                    await bondingManager.pendingFees(
                        delegator.address,
                        currentRound + 3
                    )
                ).toString(),
                (fees.toNumber() + pendingFees2).toString()
            )

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 4
            )

            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder.address, 1000, currentRound + 4]
                )
            )
            assert.equal(
                (
                    await bondingManager.pendingFees(
                        delegator.address,
                        currentRound + 4
                    )
                ).toString(),
                (pendingFees0 + pendingFees1 + pendingFees2 * 2).toString()
            )
        })

        it("should return pending fees when transcoder hasn't called reward for the previous round but has for the current round", async () => {
            const pendingFees0 = 125
            const pendingFees1 = Math.floor(
                (250 * ((1250 * PERC_DIVISOR) / 3000)) / PERC_DIVISOR
            )
            const pendingFees2 = Math.floor(
                (250 * ((1458 * PERC_DIVISOR) / 4000)) / PERC_DIVISOR
            )
            const pendingFees3 = Math.floor(
                (250 * ((1640 * PERC_DIVISOR) / 5000)) / PERC_DIVISOR
            )

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 3
            )

            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder.address, 1000, currentRound + 3]
                )
            )

            assert.equal(
                (
                    await bondingManager.pendingFees(
                        delegator.address,
                        currentRound + 3
                    )
                ).toString(),
                (pendingFees0 + pendingFees1 + pendingFees2).toString()
            )

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 4
            )
            await fixture.minter.setMockUint256(
                functionSig("currentMintableTokens()"),
                0
            )
            await fixture.minter.setMockUint256(
                functionSig("currentMintedTokens()"),
                1000
            )
            await fixture.roundsManager.execute(
                bondingManager.address,
                functionSig("setCurrentRoundTotalActiveStake()")
            )

            await bondingManager.connect(transcoder).reward()

            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder.address, 1000, currentRound + 4]
                )
            )

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 5
            )
            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder.address, 1000, currentRound + 4]
                )
            )

            assert.equal(
                (
                    await bondingManager.pendingFees(
                        delegator.address,
                        currentRound + 5
                    )
                ).toString(),
                (
                    pendingFees0 +
                    pendingFees1 +
                    pendingFees2 * 2 +
                    pendingFees3
                ).toString()
            )
        })

        describe("no fees since lastClaimRound", async () => {
            const fees =
                125 +
                Math.floor(
                    (250 * ((1250 * PERC_DIVISOR) / 3000)) / PERC_DIVISOR
                )

            beforeEach(async () => {
                await bondingManager
                    .connect(delegator)
                    .claimEarnings(currentRound + 2)

                await fixture.roundsManager.setMockUint256(
                    functionSig("currentRound()"),
                    currentRound + 3
                )
            })

            it("should return current fees when there are no additional fees since last claim round", async () => {
                // Claim fees through currentRound + 3
                // At this point, the delegator's fees should not have changed because the delegator received 0 fees
                // for currentRound + 3
                await bondingManager
                    .connect(delegator)
                    .claimEarnings(currentRound + 3)

                await fixture.roundsManager.setMockUint256(
                    functionSig("currentRound()"),
                    currentRound + 4
                )

                assert.equal(
                    (
                        await bondingManager.pendingFees(
                            delegator.address,
                            currentRound + 4
                        )
                    ).toNumber(),
                    fees
                )
            })
        })

        describe("delegator is a transcoder", () => {
            it("should return pending fees as both a delegator and a transcoder", async () => {
                const cumulativeFees = (
                    await bondingManager.getTranscoder(transcoder.address)
                ).cumulativeFees.toNumber()

                const pendingFees =
                    125 +
                    Math.floor(
                        (250 * ((1250 * PERC_DIVISOR) / 3000)) / PERC_DIVISOR
                    ) +
                    cumulativeFees

                assert.equal(
                    (
                        await bondingManager.pendingFees(
                            transcoder.address,
                            currentRound + 1
                        )
                    ).toNumber(),
                    pendingFees,
                    "should return sum of collected fees and pending fees as both a delegator and transcoder for 2 rounds"
                )
            })
        })
    })

    describe("setCurrentRoundTotalActiveStake", () => {
        let transcoder
        let currentRound

        beforeEach(async () => {
            transcoder = signers[0]
            currentRound = 100

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound - 1
            )
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                true
            )
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundLocked()"),
                false
            )

            await bondingManager
                .connect(transcoder)
                .bond(1000, transcoder.address)
            await bondingManager.connect(transcoder).transcoder(5, 10)

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound
            )
        })

        it("fails if caller is not RoundsManager", async () => {
            await expect(
                bondingManager.setCurrentRoundTotalActiveStake()
            ).to.be.revertedWith("caller must be RoundsManager")
        })

        it("sets currentRoundTotalActiveStake equal to nextRoundTotalActiveStake", async () => {
            await fixture.roundsManager.execute(
                bondingManager.address,
                functionSig("setCurrentRoundTotalActiveStake()")
            )
            assert.equal(
                await bondingManager.currentRoundTotalActiveStake(),
                1000
            )
        })

        it("should checkpoint the total active stake in the current round", async () => {
            assert.equal(await bondingManager.currentRoundTotalActiveStake(), 0)

            const tx = await fixture.roundsManager.execute(
                bondingManager.address,
                functionSig("setCurrentRoundTotalActiveStake()")
            )

            await expect(tx)
                .to.emit(fixture.bondingVotes, "CheckpointTotalActiveStake")
                .withArgs(1000, currentRound)
        })
    })

    describe("transcoderStatus", () => {
        let transcoder

        beforeEach(async () => {
            transcoder = signers[0]

            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                true
            )
            await bondingManager
                .connect(transcoder)
                .bond(1000, transcoder.address)
        })

        describe("caller is not bonded to self", () => {
            it("returns NotRegistered", async () => {
                await fixture.roundsManager.setMockUint256(
                    functionSig("currentRound()"),
                    1
                )
                await bondingManager.connect(transcoder).unbond(1000)

                assert.equal(
                    await bondingManager.transcoderStatus(transcoder.address),
                    TranscoderStatus.NotRegistered,
                    "should return NotRegistered"
                )
            })
        })

        describe("caller is bonded to self", () => {
            it("returns Registered", async () => {
                assert.equal(
                    await bondingManager.transcoderStatus(transcoder.address),
                    TranscoderStatus.Registered,
                    "should return Registered"
                )
            })
        })
    })

    describe("isActiveTranscoder", () => {
        let transcoder

        const currentRound = 100

        beforeEach(async () => {
            transcoder = signers[0]

            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                true
            )
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundLocked()"),
                false
            )
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound - 1
            )

            await bondingManager
                .connect(transcoder)
                .bond(1000, transcoder.address)
            await bondingManager.connect(transcoder).transcoder(5, 10)

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound
            )
            await fixture.roundsManager.execute(
                bondingManager.address,
                functionSig("setCurrentRoundTotalActiveStake()")
            )
        })

        describe("caller is not in transcoder pool", () => {
            it("returns false", async () => {
                await bondingManager.connect(transcoder).unbond(1000)
                await fixture.roundsManager.setMockUint256(
                    functionSig("currentRound()"),
                    currentRound + 1
                )
                assert.isFalse(
                    await bondingManager.isActiveTranscoder(transcoder.address),
                    "should return NotRegistered for caller not in transcoder pool"
                )
            })
        })

        describe("caller is in transcoder pool", () => {
            it("returns true", async () => {
                assert.isTrue(
                    await bondingManager.isActiveTranscoder(transcoder.address),
                    "should return Registered for caller in transcoder pool"
                )
            })
        })
    })

    describe("delegatorStatus", () => {
        let delegator0
        let transcoder
        const currentRound = 100

        beforeEach(async () => {
            delegator0 = signers[0]
            transcoder = signers[1]

            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                true
            )
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundLocked()"),
                false
            )
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound
            )
        })

        describe("caller has zero bonded amount", () => {
            it("returns Unbonded", async () => {
                assert.equal(
                    await bondingManager.delegatorStatus(delegator0.address),
                    DelegatorStatus.Unbonded,
                    "should return Unbonded for delegator with zero bonded amount"
                )
            })
        })

        describe("caller has a startRound", () => {
            beforeEach(async () => {
                await bondingManager
                    .connect(delegator0)
                    .bond(1000, transcoder.address)
            })

            describe("startRound is now", () => {
                it("returns Bonded", async () => {
                    const startRound = (
                        await bondingManager.getDelegator(delegator0.address)
                    )[4]
                    await fixture.roundsManager.setMockUint256(
                        functionSig("currentRound()"),
                        startRound
                    )

                    assert.equal(
                        await bondingManager.delegatorStatus(
                            delegator0.address
                        ),
                        DelegatorStatus.Bonded,
                        "should return Bonded for delegator with startRound now"
                    )
                })
            })

            describe("startRound is in the past", () => {
                it("returns Bonded", async () => {
                    const startRound = (
                        await bondingManager.getDelegator(delegator0.address)
                    )[4]
                    await fixture.roundsManager.setMockUint256(
                        functionSig("currentRound()"),
                        startRound.toNumber() + 1
                    )

                    assert.equal(
                        await bondingManager.delegatorStatus(
                            delegator0.address
                        ),
                        DelegatorStatus.Bonded,
                        "should return Bodned for delegator with startRound in past"
                    )
                })
            })

            describe("startRound is in the future", () => {
                it("returns Pending", async () => {
                    assert.equal(
                        await bondingManager.delegatorStatus(
                            delegator0.address
                        ),
                        DelegatorStatus.Pending,
                        "should return Pending for delegator with startRound in future"
                    )
                })
            })
        })
    })

    describe("isRegisteredTranscoder", () => {
        let transcoder

        const currentRound = 100

        beforeEach(async () => {
            transcoder = signers[0]

            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                true
            )
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundLocked()"),
                false
            )
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound - 1
            )

            await bondingManager
                .connect(transcoder)
                .bond(1000, transcoder.address)
            await bondingManager.connect(transcoder).transcoder(5, 10)
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 1
            )
        })

        describe("address is registered transcoder", () => {
            it("should return true", async () => {
                assert.isOk(
                    await bondingManager.isRegisteredTranscoder(
                        transcoder.address
                    ),
                    "should return true for registered transcoder"
                )
            })
        })

        describe("address is not registered transcoder", () => {
            it("should return false", async () => {
                assert.isNotOk(
                    await bondingManager.isRegisteredTranscoder(
                        signers[2].address
                    ),
                    "should return false for address that is not registered transcoder"
                )
            })
        })
    })

    describe("isValidUnbondingLock", () => {
        let delegator
        const unbondingLockID = 0
        const currentRound = 100

        beforeEach(async () => {
            delegator = signers[0]

            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                true
            )
            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundLocked()"),
                false
            )
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound
            )

            await bondingManager
                .connect(delegator)
                .bond(1000, delegator.address)

            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 1
            )
        })

        describe("unbonding lock's withdrawRound > 0", () => {
            it("should return true", async () => {
                await bondingManager.connect(delegator).unbond(500)

                assert.isOk(
                    await bondingManager.isValidUnbondingLock(
                        delegator.address,
                        unbondingLockID
                    ),
                    "should return true for lock with withdrawRound > 0"
                )
            })
        })

        describe("unbonding lock's withdrawRound = 0", () => {
            it("should return false", async () => {
                assert.isNotOk(
                    await bondingManager.isValidUnbondingLock(
                        delegator.address,
                        unbondingLockID
                    ),
                    "should return false for lock with withdrawRound = 0"
                )
            })
        })
    })

    describe("getTotalBonded", () => {
        let transcoder0
        let transcoder1
        let delegator0
        let delegator1
        let currentRound

        beforeEach(async () => {
            transcoder0 = signers[0]
            transcoder1 = signers[1]
            delegator0 = signers[2]
            delegator1 = signers[3]
            currentRound = 100

            await fixture.roundsManager.setMockBool(
                functionSig("currentRoundInitialized()"),
                true
            )
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound
            )
            await bondingManager
                .connect(transcoder0)
                .bond(1000, transcoder0.address)
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 1
            )
            await fixture.roundsManager.execute(
                bondingManager.address,
                functionSig("setCurrentRoundTotalActiveStake()")
            )
        })

        it("returns the total active stake for the current round", async () => {
            // Check that getTotalBonded() reflects active stake of transcoder0
            assert.equal(await bondingManager.getTotalBonded(), 1000)
        })

        it("returns the same value when called multiple times in the same round", async () => {
            await bondingManager
                .connect(transcoder1)
                .bond(2000, transcoder1.address)

            // Check that getTotalBonded() does not reflect active stake of transcoder1 because
            // the next round has not been initialized
            assert.equal(await bondingManager.getTotalBonded(), 1000)

            await bondingManager
                .connect(delegator0)
                .bond(500, transcoder0.address)

            // Check that getTotalBonded() does not reflect new stake delegated to transcoder0 because
            // the next round has not been initialized
            assert.equal(await bondingManager.getTotalBonded(), 1000)
        })

        it("returns updated total active stake for a round after it is initialized", async () => {
            await bondingManager
                .connect(transcoder1)
                .bond(2000, transcoder1.address)
            await bondingManager
                .connect(delegator0)
                .bond(500, transcoder0.address)
            await bondingManager
                .connect(delegator1)
                .bond(700, transcoder1.address)
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                currentRound + 2
            )
            await fixture.roundsManager.execute(
                bondingManager.address,
                functionSig("setCurrentRoundTotalActiveStake()")
            )

            // Check that getTotalBonded() includes active stake of transcoder1 (includes new stake delegated from delegator1)
            // and new stake delegated to transcoder0 by delegator0
            assert.equal(await bondingManager.getTotalBonded(), 4200)
        })
    })
})
