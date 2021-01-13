import Fixture from "./helpers/Fixture"
import expectRevertWithReason from "../helpers/expectFail"
import {contractId, functionSig, functionEncodedABI} from "../../utils/helpers"
import {constants} from "../../utils/constants"
import BN from "bn.js"
import truffleAssert from "truffle-assertions"
import {assert} from "chai"

const BondingManager = artifacts.require("BondingManager")
const LinkedList = artifacts.require("SortedDoublyLL")

const {DelegatorStatus, TranscoderStatus} = constants

contract("BondingManager", accounts => {
    let fixture
    let bondingManager

    const NUM_ACTIVE_TRANSCODERS = 2
    const UNBONDING_PERIOD = 2
    const MAX_EARNINGS_CLAIMS_ROUNDS = 20

    const PERC_DIVISOR = 1000000
    const PERC_MULTIPLIER = PERC_DIVISOR / 100

    before(async () => {
        fixture = new Fixture(web3)
        await fixture.deploy()

        const ll = await LinkedList.new()
        BondingManager.link("SortedDoublyLL", ll.address)
        bondingManager = await fixture.deployAndRegister(BondingManager, "BondingManager", fixture.controller.address)

        await bondingManager.setUnbondingPeriod(UNBONDING_PERIOD)
        await bondingManager.setNumActiveTranscoders(NUM_ACTIVE_TRANSCODERS)
        await bondingManager.setMaxEarningsClaimsRounds(MAX_EARNINGS_CLAIMS_ROUNDS)
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("setController", () => {
        it("should fail if caller is not Controller", async () => {
            await expectRevertWithReason(bondingManager.setController(accounts[0]), "caller must be Controller")
        })

        it("should set new Controller", async () => {
            await fixture.controller.updateController(contractId("BondingManager"), accounts[0])

            assert.equal(await bondingManager.controller.call(), accounts[0], "should set new Controller")
        })
    })

    describe("setUnbondingPeriod", () => {
        it("should fail if caller is not Controller owner", async () => {
            await expectRevertWithReason(bondingManager.setUnbondingPeriod(5, {from: accounts[2]}), "caller must be Controller owner")
        })

        it("should set unbondingPeriod", async () => {
            await bondingManager.setUnbondingPeriod(5)

            assert.equal(await bondingManager.unbondingPeriod.call(), 5, "wrong unbondingPeriod")
        })
    })

    describe("setNumActiveTranscoders", () => {
        it("should fail if caller is not Controller owner", async () => {
            await expectRevertWithReason(bondingManager.setNumActiveTranscoders(7, {from: accounts[2]}), "caller must be Controller owner")
        })

        it("should set numActiveTranscoders", async () => {
            await bondingManager.setNumActiveTranscoders(4)

            assert.equal(await bondingManager.getTranscoderPoolMaxSize(), 4, "wrong numActiveTranscoders")
        })
    })

    describe("setMaxEarningsClaimsRounds", () => {
        it("should fail if caller is not Controller owner", async () => {
            await expectRevertWithReason(bondingManager.setMaxEarningsClaimsRounds(2, {from: accounts[2]}), "caller must be Controller owner")
        })

        it("should set maxEarningsClaimsRounds", async () => {
            await bondingManager.setMaxEarningsClaimsRounds(2)

            assert.equal(await bondingManager.maxEarningsClaimsRounds.call(), 2, "wrong maxEarningsClaimsRounds")
        })
    })

    describe("transcoder", () => {
        const currentRound = 100
        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
        })

        it("should fail if current round is not initialized", async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), false)

            await expectRevertWithReason(bondingManager.transcoder(5, 10), "current round is not initialized")
        })

        it("should fail if the current round is locked", async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), true)

            await expectRevertWithReason(bondingManager.transcoder(5, 10), "can't update transcoder params, current round is locked")
        })

        it("should fail if rewardCut is not a valid percentage <= 100%", async () => {
            await expectRevertWithReason(bondingManager.transcoder(PERC_DIVISOR + 1, 10), "invalid rewardCut percentage")
        })

        it("should fail if feeShare is not a valid percentage <= 100%", async () => {
            await expectRevertWithReason(bondingManager.transcoder(5, PERC_DIVISOR + 1), "invalid feeShare percentage")
        })

        describe("transcoder is not already registered", () => {
            it("should fail if caller is not delegated to self with a non-zero bonded amount", async () => {
                await expectRevertWithReason(bondingManager.transcoder(5, 10), "transcoder must be registered")
            })

            it("should set transcoder's pending rewardCut and feeShare", async () => {
                await bondingManager.bond(1000, accounts[0])
                await bondingManager.transcoder(5, 10)

                let tInfo = await bondingManager.getTranscoder(accounts[0])
                assert.equal(tInfo[1], 5, "wrong rewardCut")
                assert.equal(tInfo[2], 10, "wrong feeShare")
            })

            describe("transcoder pool is not full", () => {
                it("should add new transcoder to the pool", async () => {
                    await bondingManager.bond(1000, accounts[0])
                    const txRes = await bondingManager.transcoder(5, 10)

                    truffleAssert.eventEmitted(
                        txRes,
                        "TranscoderUpdate",
                        e => e.transcoder == accounts[0] &&
                            e.rewardCut == 5 &&
                            e.feeShare == 10,
                        "TranscoderUpdate event not emitted correctly"
                    )

                    assert.equal(await bondingManager.nextRoundTotalActiveStake(), 1000, "wrong next total stake")
                    assert.equal(await bondingManager.getTranscoderPoolSize(), 1, "wrong transcoder pool size")
                    assert.equal(await bondingManager.getFirstTranscoderInPool(), accounts[0], "wrong first transcoder in pool")
                    assert.equal(await bondingManager.transcoderTotalStake(accounts[0]), 1000, "wrong transcoder total stake")
                })

                it("should add multiple additional transcoders to the pool", async () => {
                    await bondingManager.bond(2000, accounts[0])
                    await bondingManager.transcoder(5, 10)
                    await bondingManager.bond(1000, accounts[1], {from: accounts[1]})
                    await bondingManager.transcoder(5, 10, {from: accounts[1]})

                    assert.equal(await bondingManager.nextRoundTotalActiveStake(), 3000, "wrong next total stake")
                    assert.equal(await bondingManager.getTranscoderPoolSize(), 2, "wrong transcoder pool size")
                    assert.equal(await bondingManager.getFirstTranscoderInPool(), accounts[0], "wrong first transcoder in pool")
                    assert.equal(await bondingManager.getNextTranscoderInPool(accounts[0]), accounts[1], "wrong second transcoder in pool")
                    assert.equal(await bondingManager.transcoderTotalStake(accounts[0]), 2000, "wrong first transcoder total stake")
                    assert.equal(await bondingManager.transcoderTotalStake(accounts[1]), 1000, "wrong second transcoder total stake")
                })
            })

            describe("transcoder pool is full", () => {
                describe("caller has sufficient delegated stake to join pool", () => {
                    it("should evict the transcoder with the least delegated stake and add new transcoder to the pool", async () => {
                        const transcoders = accounts.slice(0, 2)
                        const newTranscoder = accounts[3]

                        await Promise.all(transcoders.map((account, idx) => {
                            return bondingManager.bond(1000 * (idx + 1), account, {from: account}).then(() => {
                                return bondingManager.transcoder(5, 10, {from: account})
                            })
                        }))

                        const nextTotalStake = (await bondingManager.nextRoundTotalActiveStake()).toNumber()

                        // Caller bonds 6000 which is more than transcoder with least delegated stake
                        await bondingManager.bond(6000, newTranscoder, {from: newTranscoder})
                        const txRes = await bondingManager.transcoder(5, 10, {from: newTranscoder})
                        truffleAssert.eventEmitted(
                            txRes,
                            "TranscoderUpdate",
                            e => e.transcoder == newTranscoder &&
                                    e.rewardCut == 5 &&
                                    e.feeShare == 10,
                            "TranscoderUpdate event not emitted correctly"
                        )
                        await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)

                        // Subtract evicted transcoder's delegated stake and add new transcoder's delegated stake
                        const expNextTotalStake = nextTotalStake - 1000 + 6000
                        assert.equal(await bondingManager.nextRoundTotalActiveStake(), expNextTotalStake, "wrong next total stake")

                        assert.isTrue(await bondingManager.isActiveTranscoder(newTranscoder), "caller should be active as transocder")
                        assert.equal(await bondingManager.getTranscoderPoolSize(), 2, "wrong transcoder pool size")
                        assert.equal(await bondingManager.transcoderTotalStake(newTranscoder), 6000, "wrong transcoder total stake")
                        assert.isFalse(await bondingManager.isActiveTranscoder(accounts[0]), "transcoder with least delegated stake should be evicted")
                    })
                })

                describe("caller has insufficient delegated stake to join pool", () => {
                    it("should not add caller with less delegated stake than transcoder with least delegated stake in pool", async () => {
                        const transcoders = accounts.slice(0, 5)
                        const newTranscoder = accounts[5]

                        await Promise.all(transcoders.map(account => {
                            return bondingManager.bond(2000, account, {from: account}).then(() => {
                                return bondingManager.transcoder(5, 10, {from: account})
                            })
                        }))

                        // Caller bonds 600 - less than transcoder with least delegated stake
                        await bondingManager.bond(600, newTranscoder, {from: newTranscoder})
                        await bondingManager.transcoder(5, 10, {from: newTranscoder})
                        const txRes = await bondingManager.transcoder(5, 10, {from: newTranscoder})
                        truffleAssert.eventEmitted(
                            txRes,
                            "TranscoderUpdate",
                            e => e.transcoder == newTranscoder &&
                                e.rewardCut == 5 &&
                                e.feeShare == 10,
                            "TranscoderUpdate event not emitted correctly"
                        )
                        await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)

                        assert.isFalse(await bondingManager.isActiveTranscoder(newTranscoder), "should not register caller as a transcoder in the pool")
                    })

                    it("should not add caller with equal delegated stake to transcoder with least delegated stake in pool", async () => {
                        const transcoders = accounts.slice(0, 5)
                        const newTranscoder = accounts[5]

                        await Promise.all(transcoders.map(account => {
                            return bondingManager.bond(2000, account, {from: account}).then(() => {
                                return bondingManager.transcoder(5, 10, {from: account})
                            })
                        }))

                        // Caller bonds 2000 - same as transcoder with least delegated stake
                        await bondingManager.bond(2000, newTranscoder, {from: newTranscoder})
                        const txRes = await bondingManager.transcoder(5, 10, {from: newTranscoder})
                        truffleAssert.eventEmitted(
                            txRes,
                            "TranscoderUpdate",
                            e => e.transcoder == newTranscoder &&
                                e.rewardCut == 5 &&
                                e.feeShare == 10,
                            "TranscoderUpdate event not emitted correctly"
                        )
                        await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
                        assert.isFalse(await bondingManager.isActiveTranscoder(newTranscoder), "should not register caller as a transcoder in the pool")
                    })
                })
            })
        })

        describe("transcoder is already registered", () => {
            it("should update transcoder's pending rewardCut and feeShare", async () => {
                await bondingManager.bond(1000, accounts[0])
                await bondingManager.transcoder(5, 10)

                let tInfo = await bondingManager.getTranscoder(accounts[0])
                assert.equal(tInfo[1], 5, "wrong rewardCut")
                assert.equal(tInfo[2], 10, "wrong feeShare")

                await bondingManager.transcoder(10, 15)

                tInfo = await bondingManager.getTranscoder(accounts[0])
                assert.equal(tInfo[1], 10, "wrong rewardCut")
                assert.equal(tInfo[2], 15, "wrong feeShare")
            })
        })

        describe("transcoder is active", () => {
            beforeEach(async () => {
                await bondingManager.bond(1000, accounts[0])
                await bondingManager.transcoder(5, 10)
                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
            })

            it("fails if transcoder has not called reward for the current round", async () => {
                await expectRevertWithReason(bondingManager.transcoder(10, 20), "caller can't be active or must have already called reward for the current round")
            })

            it("sets rewardCut and feeShare if transcoder has already called reward in the current round", async () => {
                await bondingManager.reward()
                await bondingManager.transcoder(10, 20)
                const transcoder = await bondingManager.getTranscoder(accounts[0])
                assert.equal(transcoder.rewardCut, 10, "wrong rewardCut")
                assert.equal(transcoder.feeShare, 20, "wrong feeShare")
            })
        })
    })

    describe("bond", () => {
        const transcoder0 = accounts[0]
        const transcoder1 = accounts[1]
        const transcoder2 = accounts[2]
        const nonTranscoder = accounts[9]
        const delegator = accounts[3]
        const delegator2 = accounts[4]
        const currentRound = 100

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound - 1)

            await bondingManager.bond(1000, transcoder0, {from: transcoder0})
            await bondingManager.transcoder(5, 10, {from: transcoder0})
            await bondingManager.bond(2000, transcoder1, {from: transcoder1})
            await bondingManager.transcoder(5, 10, {from: transcoder1})
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
        })

        it("should fail if current round is not initialized", async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), false)

            await expectRevertWithReason(bondingManager.bond(1000, transcoder0, {from: delegator}), "current round is not initialized")
        })

        describe("update transcoder pool", () => {
            beforeEach(async () => {
                await bondingManager.bond(500, transcoder2, {from: transcoder2})
                await bondingManager.transcoder(5, 10, {from: transcoder2})
                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
                await fixture.roundsManager.execute(bondingManager.address, functionSig("setCurrentRoundTotalActiveStake()"))
            })

            it("adds a new transcoder to the pool", async () => {
                await bondingManager.bond(1000, transcoder2, {from: delegator})
                const firstTranscoder = await bondingManager.getFirstTranscoderInPool()
                const firstStake = await bondingManager.transcoderTotalStake(firstTranscoder)
                const secondTranscoder = await bondingManager.getNextTranscoderInPool(firstTranscoder)
                const secondStake = await bondingManager.transcoderTotalStake(secondTranscoder)
                const firstDel = await bondingManager.getDelegator(firstTranscoder)
                const secondDel = await bondingManager.getDelegator(secondTranscoder)
                assert.equal(firstTranscoder, transcoder1)
                assert.equal(firstStake.toString(), firstDel.delegatedAmount.toString())
                assert.equal(secondTranscoder, transcoder2)
                assert.equal(secondStake.toString(), secondDel.delegatedAmount.toString())
            })

            it("should update current earningsPool totalStake when lastActiveStakeUpdateRound < currentRound", async () => {
                const lastActiveStakeUpdateRound = (await bondingManager.getTranscoder(transcoder0)).lastActiveStakeUpdateRound
                assert.isBelow(lastActiveStakeUpdateRound.toNumber(), currentRound + 1)

                await bondingManager.bond(1000, transcoder0, {from: delegator})

                const lastActiveStake = (await bondingManager.getTranscoderEarningsPoolForRound(transcoder0, lastActiveStakeUpdateRound)).totalStake
                const pool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder0, currentRound + 1)
                assert.equal(pool.totalStake.toString(), lastActiveStake.toString())
            })

            it("should not update current earningsPool totalStake when lastActiveStakeUpdateRound = currentRound", async () => {
                await bondingManager.bond(500, transcoder0, {from: delegator})
                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 2)
                const lastActiveStakeUpdateRound = (await bondingManager.getTranscoder(transcoder0)).lastActiveStakeUpdateRound
                assert.equal(lastActiveStakeUpdateRound.toNumber(), currentRound + 2)

                const startActiveStake = (await bondingManager.getTranscoderEarningsPoolForRound(transcoder0, currentRound + 2)).totalStake
                await bondingManager.bond(1000, transcoder0, {from: delegator})
                const endActiveStake = (await bondingManager.getTranscoderEarningsPoolForRound(transcoder0, currentRound + 2)).totalStake

                assert.equal(startActiveStake.toString(), endActiveStake.toString())
            })

            it("should not update current earningsPool totalStake when lastActiveStakeUpdateRound > currentRound", async () => {
                await bondingManager.bond(500, transcoder0, {from: delegator})
                const lastActiveStakeUpdateRound = (await bondingManager.getTranscoder(transcoder0)).lastActiveStakeUpdateRound
                assert.isAbove(lastActiveStakeUpdateRound.toNumber(), currentRound + 1)

                const startActiveStake = (await bondingManager.getTranscoderEarningsPoolForRound(transcoder0, currentRound + 1)).totalStake
                await bondingManager.bond(500, transcoder0, {from: delegator})
                const endActiveStake = (await bondingManager.getTranscoderEarningsPoolForRound(transcoder0, currentRound + 1)).totalStake

                assert.equal(startActiveStake.toString(), endActiveStake.toString())
            })

            describe("evicts a transcoder from the pool", () => {
                it("last transcoder gets evicted and new transcoder gets inserted", async () => {
                    const txRes = await bondingManager.bond(2000, transcoder2, {from: delegator})
                    truffleAssert.eventEmitted(
                        txRes,
                        "TranscoderDeactivated",
                        e => e.transcoder == transcoder0 && e.deactivationRound == currentRound + 2,
                        "TranscoderDeactivated event not emitted correctly"
                    )
                    await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 2)
                    assert.isTrue(await bondingManager.isActiveTranscoder(transcoder2))
                    assert.isTrue(await bondingManager.isActiveTranscoder(transcoder1))
                    assert.isFalse(await bondingManager.isActiveTranscoder(transcoder0))
                    assert.equal((await bondingManager.transcoderTotalStake(transcoder2)).toString(), "2500")
                })

                it("sets deactivationRound for the inserted transcoder to the max possible round number", async () => {
                    await bondingManager.bond(2000, transcoder2, {from: delegator})
                    assert.equal((await bondingManager.getTranscoder(transcoder2)).deactivationRound, 2 ** 256 - 1)
                })

                it("sets the deactivationRound for the evicted transcoder to the next round", async () => {
                    await bondingManager.bond(2000, transcoder2, {from: delegator})
                    assert.equal((await bondingManager.getTranscoder(transcoder0)).deactivationRound, currentRound + 2)
                })

                it("fires a TranscoderActivated event for the new transcoder", async () => {
                    const txRes = await bondingManager.bond(2000, transcoder2, {from: delegator})
                    truffleAssert.eventEmitted(
                        txRes,
                        "TranscoderActivated",
                        e => e.transcoder == transcoder2 && e.activationRound == currentRound + 2,
                        "TranscoderActivated event not emitted correctly"
                    )
                })
            })

            it("inserts into pool without evicting if pool is not full", async () => {
                await bondingManager.unbond(2000, {from: transcoder1})
                await bondingManager.bond(2500, transcoder2, {from: delegator})
                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 2)
                assert.isTrue(await bondingManager.isActiveTranscoder(transcoder2))
                assert.isTrue(await bondingManager.isActiveTranscoder(transcoder0))
                // transcoder 2 should be first
                assert.equal(await bondingManager.getFirstTranscoderInPool(), transcoder2)
            })

            it("doesn't insert into pool when stake is too low", async () => {
                await bondingManager.bond(10, transcoder2, {from: delegator})
                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 2)
                assert.isFalse(await bondingManager.isActiveTranscoder(transcoder2))
            })

            it("updates total stake in earnings pool for next round", async () => {
                await bondingManager.bond(2000, transcoder2, {from: delegator})
                const poolT2 = await bondingManager.getTranscoderEarningsPoolForRound(transcoder2, currentRound + 2)
                assert.equal(poolT2.totalStake, 2500)
            })
        })

        describe("caller is unbonded", () => {
            it("should fail if provided amount = 0", async () => {
                await expectRevertWithReason(bondingManager.bond(0, transcoder0, {from: delegator}), "delegation amount must be greater than 0")
            })

            it("should set startRound to the next round", async () => {
                await bondingManager.bond(1000, transcoder0, {from: delegator})

                const dInfo = await bondingManager.getDelegator(delegator)
                assert.equal(dInfo[4], currentRound + 1, "wrong startRound")
            })

            it("should set delegate", async () => {
                await bondingManager.bond(1000, transcoder0, {from: delegator})

                assert.equal((await bondingManager.getDelegator(delegator))[2], transcoder0, "wrong delegateAddress")
            })

            it("should update delegate and bonded amount", async () => {
                const startDelegatedAmount = (await bondingManager.getDelegator(transcoder0))[3]
                await bondingManager.bond(1000, transcoder0, {from: delegator})
                const endDelegatedAmount = (await bondingManager.getDelegator(transcoder0))[3]

                assert.equal(endDelegatedAmount.sub(startDelegatedAmount), 1000, "wrong change in delegatedAmount")
                assert.equal((await bondingManager.getDelegator(delegator))[0], 1000, "wrong bondedAmount")
            })

            it("should fire a Bond event when bonding from unbonded", async () => {
                const txRes = await bondingManager.bond(1000, transcoder0, {from: delegator})
                truffleAssert.eventEmitted(
                    txRes,
                    "Bond",
                    e => e.newDelegate == transcoder0 &&
                        e.oldDelegate == constants.NULL_ADDRESS &&
                        e.delegator == delegator &&
                        e.additionalAmount == 1000 &&
                        e.bondedAmount == 1000,
                    "Bond event not emitted correctly"
                )
            })

            it("fires an EarningsClaimed event when bonding from unbonded", async () => {
                const txResult = await bondingManager.bond(1000, transcoder0, {from: delegator})

                truffleAssert.eventEmitted(
                    txResult,
                    "EarningsClaimed",
                    e => e.delegate === constants.NULL_ADDRESS &&
                        e.delegator == delegator &&
                        e.fees == 0 &&
                        e.rewards == 0 &&
                        e.startRound == 1 &&
                        e.endRound == currentRound,
                    "EarningsClaimed event not emitted correctly"
                )
            })

            it("it doesn't fire an EarningsClaimed event when bonding twice in the same round", async () => {
                await bondingManager.bond(1000, transcoder0, {from: delegator})
                const txResult = await bondingManager.bond(1000, transcoder0, {from: delegator})

                truffleAssert.eventNotEmitted(txResult, "EarningsClaimed", e => e.delegator == delegator, "Logs should not include an EarningsClaimed event")
            })

            describe("delegate is a registered transcoder", () => {
                it("should increase transcoder's delegated stake in pool", async () => {
                    const startNextTotalStake = await bondingManager.nextRoundTotalActiveStake()
                    const startTranscoderTotalStake = await bondingManager.transcoderTotalStake(transcoder0)
                    await bondingManager.bond(1000, transcoder0, {from: delegator})
                    const endNextTotalStake = await bondingManager.nextRoundTotalActiveStake()
                    const endTranscoderTotalStake = await bondingManager.transcoderTotalStake(transcoder0)

                    assert.equal(endNextTotalStake.sub(startNextTotalStake), 1000, "wrong change in next total stake")
                    assert.equal(endTranscoderTotalStake.sub(startTranscoderTotalStake), 1000, "wrong change in transcoder total stake")
                })

                it("should update delegate's position in transcoder pool", async () => {
                    await bondingManager.bond(3000, transcoder0, {from: delegator})
                    assert.equal(await bondingManager.getFirstTranscoderInPool(), transcoder0, "did not correctly update position in transcoder pool")
                })

                it("should increase the total stake for the next round", async () => {
                    const startTotalStake = await bondingManager.nextRoundTotalActiveStake()
                    await bondingManager.bond(3000, transcoder0, {from: delegator})
                    const endTotalStake = await bondingManager.nextRoundTotalActiveStake()
                    assert.equal(endTotalStake.sub(startTotalStake), 3000)
                })

                it("should update transcoder's lastActiveStakeUpdateRound", async () => {
                    await bondingManager.bond(3000, transcoder0, {from: delegator})
                    assert.equal((await bondingManager.getTranscoder(transcoder0)).lastActiveStakeUpdateRound, currentRound + 1)
                })
            })

            describe("delegate is not a registered transcoder", () => {
                it("should not update next total stake", async () => {
                    const startNextTotalStake = await bondingManager.nextRoundTotalActiveStake()
                    await bondingManager.bond(1000, nonTranscoder, {from: delegator})
                    const endNextTotalStake = await bondingManager.nextRoundTotalActiveStake()

                    assert.equal(endNextTotalStake.sub(startNextTotalStake), 0, "wrong change in next total stake")
                })

                it("should not update total active stake for the next round", async () => {
                    const startTotalStake = await bondingManager.nextRoundTotalActiveStake()
                    await bondingManager.bond(1000, nonTranscoder, {from: delegator})
                    const endTotalStake = await bondingManager.nextRoundTotalActiveStake()
                    assert.equal(startTotalStake.sub(endTotalStake), 0, "wrong change in total active stake for next round")
                })

                it("should not update transcoder's lastActiveStakeUpdateRound", async () => {
                    await bondingManager.bond(3000, nonTranscoder, {from: delegator})
                    assert.equal((await bondingManager.getTranscoder(nonTranscoder)).lastActiveStakeUpdateRound, 0)
                })
            })
        })

        describe("caller is bonded", () => {
            beforeEach(async () => {
                await bondingManager.bond(2000, transcoder0, {from: delegator})
            })

            describe("caller is changing delegate", () => {
                it("should fail if caller is a registered transcoder", async () => {
                    await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
                    await expectRevertWithReason(bondingManager.bond(0, transcoder1, {from: transcoder0}), "registered transcoders can't delegate towards other addresses")
                })

                it("should set startRound to next round", async () => {
                    await bondingManager.bond(0, transcoder1, {from: delegator})

                    assert.equal((await bondingManager.getDelegator(delegator))[4], currentRound + 1, "wrong startRound")
                })

                it("should decrease old delegate's delegated amount", async () => {
                    const startDelegatedAmount = (await bondingManager.getDelegator(transcoder0))[3]
                    await bondingManager.bond(0, transcoder1, {from: delegator})
                    const endDelegatedAmount = (await bondingManager.getDelegator(transcoder0))[3]

                    assert.equal(startDelegatedAmount.sub(endDelegatedAmount), 2000, "wrong change in delegatedAmount")
                })

                it("should set new delegate", async () => {
                    await bondingManager.bond(0, transcoder1, {from: delegator})

                    assert.equal((await bondingManager.getDelegator(delegator))[2], transcoder1, "wrong delegateAddress")
                })

                describe("old delegate is registered transcoder", () => {
                    describe("new delegate is a registered transcoder", () => {
                        it("should update new delegate's position in transcoder pool", async () => {
                            await bondingManager.bond(0, transcoder1, {from: delegator})
                            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
                            // New delegate was not previously first transcoder in pool and now is
                            assert.equal(await bondingManager.getFirstTranscoderInPool(), transcoder1, "did not correctly update position in pool")
                        })

                        it("should not increase/decrease the total active stake for the next round", async () => {
                            const startTotalStake = await bondingManager.nextRoundTotalActiveStake()
                            await bondingManager.bond(0, transcoder1, {from: delegator})
                            const endTotalStake = await bondingManager.nextRoundTotalActiveStake()
                            assert.equal(startTotalStake.sub(endTotalStake), 0, "wrong change in total active stake for next round")
                        })

                        it("should update old delegate and new delegate's lastActiveStakeUpdateRound", async () => {
                            await bondingManager.bond(0, transcoder1, {from: delegator})
                            assert.equal((await bondingManager.getTranscoder(transcoder0)).lastActiveStakeUpdateRound, currentRound + 1)
                            assert.equal((await bondingManager.getTranscoder(transcoder1)).lastActiveStakeUpdateRound, currentRound + 1)
                        })
                    })

                    describe("new delegate is not a registered transcoder", () => {
                        it("should not update new delegate's position in transcoder pool", async () => {
                            await bondingManager.bond(0, nonTranscoder, {from: delegator})
                            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
                            assert.isFalse(await bondingManager.isActiveTranscoder(nonTranscoder))
                        })

                        it("should decrease the total active stake for the next round", async () => {
                            const startTotalStake = await bondingManager.nextRoundTotalActiveStake()
                            await bondingManager.bond(0, nonTranscoder, {from: delegator})
                            const endTotalStake = await bondingManager.nextRoundTotalActiveStake()
                            assert.equal(startTotalStake.sub(endTotalStake), 2000, "wrong change in total active stake for next round")
                        })

                        it("should only update old delegate's lastActiveStakeUpdateRound", async () => {
                            await bondingManager.bond(0, nonTranscoder, {from: delegator})
                            assert.equal((await bondingManager.getTranscoder(transcoder0)).lastActiveStakeUpdateRound, currentRound + 1)
                            assert.equal((await bondingManager.getTranscoder(nonTranscoder)).lastActiveStakeUpdateRound, 0)
                        })
                    })
                })

                describe("old delegate is not a registered transcoder", () => {
                    beforeEach(async () => {
                        await bondingManager.bond(0, delegator2, {from: delegator})
                    })
                    describe("new delegate is a registered transcoder", () => {
                        it("should update new delegate's position in transcoder pool", async () => {
                            await bondingManager.bond(0, transcoder0, {from: delegator})
                            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
                            // New delegate was not previously first transcoder in pool and now is
                            assert.equal(await bondingManager.getFirstTranscoderInPool(), transcoder0, "did not correctly update position in pool")
                        })

                        it("should increase the total active stake for the next round", async () => {
                            const startTotalStake = await bondingManager.nextRoundTotalActiveStake()
                            await bondingManager.bond(0, transcoder1, {from: delegator})
                            const endTotalStake = await bondingManager.nextRoundTotalActiveStake()
                            assert.equal(endTotalStake.sub(startTotalStake), 2000, "wrong change in total active stake for next round")
                        })

                        it("should only update new delegate lastActiveStakeUpdateRound", async () => {
                            await bondingManager.bond(0, transcoder0, {from: delegator})
                            assert.equal((await bondingManager.getTranscoder(transcoder0)).lastActiveStakeUpdateRound, currentRound + 1)
                            assert.equal((await bondingManager.getTranscoder(delegator2)).lastActiveStakeUpdateRound, 0)
                        })
                    })

                    describe("new delegate is not a registered transcoder()", () => {
                        it("should not update the new delegate's position in transcoder pool", async () => {
                            await bondingManager.bond(0, nonTranscoder, {from: delegator})
                            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
                            assert.isFalse(await bondingManager.isActiveTranscoder(nonTranscoder), "did not correctly update position in pool")
                        })

                        it("should not update new delegate's lastActiveStakeUpdateRound", async () => {
                            await bondingManager.bond(0, nonTranscoder, {from: delegator})
                            assert.equal((await bondingManager.getTranscoder(nonTranscoder)).lastActiveStakeUpdateRound, 0)
                        })
                    })
                })

                describe("caller is just moving bonded stake because provided amount = 0", () => {
                    it("should update new delegate's delegated amount with current bonded stake", async () => {
                        const startDelegatedAmount = (await bondingManager.getDelegator(transcoder1))[3]
                        await bondingManager.bond(0, transcoder1, {from: delegator})

                        const endDelegatedAmount = (await bondingManager.getDelegator(transcoder1))[3]

                        assert.equal(endDelegatedAmount.sub(startDelegatedAmount), 2000, "wrong change in delegatedAmount")
                    })

                    it("should not update bonded amount", async () => {
                        const startBondedAmount = (await bondingManager.getDelegator(delegator))[0]
                        await bondingManager.bond(0, transcoder1, {from: delegator})
                        const endBondedAmount = (await bondingManager.getDelegator(delegator))[0]

                        assert.equal(endBondedAmount.sub(startBondedAmount), 0, "bondedAmount change should be 0")
                    })

                    it("should fire a Bond event when changing delegates", async () => {
                        const txRes = await bondingManager.bond(0, transcoder1, {from: delegator})
                        truffleAssert.eventEmitted(
                            txRes,
                            "Bond",
                            e => e.newDelegate == transcoder1 &&
                                e.oldDelegate == transcoder0 &&
                                e.delegator == delegator &&
                                e.additionalAmount == 0 &&
                                e.bondedAmount == 2000,
                            "Bond event not emitted correctly"
                        )
                    })

                    describe("new delegate is registered transcoder", () => {
                        it("should increase transcoder's total stake in pool with current bonded stake", async () => {
                            const startTranscoderTotalStake = await bondingManager.transcoderTotalStake(transcoder1)
                            await bondingManager.bond(0, transcoder1, {from: delegator})
                            const endTranscoderTotalStake = await bondingManager.transcoderTotalStake(transcoder1)

                            assert.equal(endTranscoderTotalStake.sub(startTranscoderTotalStake), 2000, "wrong change in transcoder total stake")
                        })

                        describe("old delegate is registered transcoder", () => {
                            it("should not change next total stake", async () => {
                                const startNextTotalStake = await bondingManager.nextRoundTotalActiveStake()
                                await bondingManager.bond(0, transcoder1, {from: delegator})
                                const endNextTotalStake = await bondingManager.nextRoundTotalActiveStake()

                                assert.equal(endNextTotalStake.sub(startNextTotalStake), 0, "wrong change in next total stake")
                            })
                        })

                        describe("old delegate is not registered transcoder", () => {
                            it("should increase next total stake", async () => {
                                // Delegate to non-transcoder
                                await bondingManager.bond(0, nonTranscoder, {from: delegator})

                                const startNextTotalStake = await bondingManager.nextRoundTotalActiveStake()
                                await bondingManager.bond(0, transcoder1, {from: delegator})
                                const endNextTotalStake = await bondingManager.nextRoundTotalActiveStake()

                                assert.equal(endNextTotalStake.sub(startNextTotalStake), 2000, "wrong change in next total stake")
                            })
                        })
                    })

                    describe("new delegate is not registered transcoder", () => {
                        describe("old delegate is registered transcoder", () => {
                            it("should decrease next total stake", async () => {
                                const startNextTotalStake = await bondingManager.nextRoundTotalActiveStake()
                                await bondingManager.bond(0, nonTranscoder, {from: delegator})
                                const endNextTotalStake = await bondingManager.nextRoundTotalActiveStake()

                                assert.equal(startNextTotalStake.sub(endNextTotalStake), 2000, "wrong change in next total stake")
                            })
                        })

                        describe("old delegate is not registered transcoder", () => {
                            it("should not change next total stake", async () => {
                                // Delegate to non-transcoder
                                await bondingManager.bond(0, nonTranscoder, {from: delegator})

                                const startNextTotalStake = await bondingManager.nextRoundTotalActiveStake()
                                await bondingManager.bond(0, delegator2, {from: delegator})
                                const endNextTotalStake = await bondingManager.nextRoundTotalActiveStake()

                                assert.equal(endNextTotalStake.sub(startNextTotalStake), 0, "wrong change in next total stake")
                            })
                        })
                    })

                    describe("old delegate is registered transcoder", () => {
                        it("should decrease transcoder's total stake in pool by current bonded stake", async () => {
                            const startTranscoderTotalStake = await bondingManager.transcoderTotalStake(transcoder0)
                            await bondingManager.bond(0, transcoder1, {from: delegator})
                            const endTranscoderTotalStake = await bondingManager.transcoderTotalStake(transcoder0)

                            assert.equal(startTranscoderTotalStake.sub(endTranscoderTotalStake), 2000, "wrong change in transcoder total stake")
                        })
                    })
                })

                describe("caller is increasing and moving bonded stake because provided amount > 0", () => {
                    it("should update new delegate's delegated amount with current bonded stake + provided amount", async () => {
                        const startDelegatedAmount = (await bondingManager.getDelegator(transcoder1))[3]
                        await bondingManager.bond(1000, transcoder1, {from: delegator})
                        const endDelegatedAmount = (await bondingManager.getDelegator(transcoder1))[3]

                        assert.equal(endDelegatedAmount.sub(startDelegatedAmount), 3000, "wrong change in delegatedAmount")
                    })

                    it("should update bonded amount", async () => {
                        const startBondedAmount = (await bondingManager.getDelegator(delegator))[0]
                        await bondingManager.bond(1000, transcoder1, {from: delegator})
                        const endBondedAmount = (await bondingManager.getDelegator(delegator))[0]

                        assert.equal(endBondedAmount.sub(startBondedAmount), 1000, "wrong change in bondedAmount")
                    })


                    it("should increase the total stake for the next round", async () => {
                        const startTotalStake = await bondingManager.nextRoundTotalActiveStake()
                        await bondingManager.bond(1000, transcoder1, {from: delegator})
                        const endTotalStake = await bondingManager.nextRoundTotalActiveStake()
                        assert.equal(endTotalStake.sub(startTotalStake), 1000, "wrong change in total next round stake")
                    })

                    it("should fire a Bond event when increasing bonded stake and changing delegates", async () => {
                        const txRes = await bondingManager.bond(1000, transcoder1, {from: delegator})
                        truffleAssert.eventEmitted(
                            txRes,
                            "Bond",
                            e => e.newDelegate == transcoder1 &&
                                e.oldDelegate == transcoder0 &&
                                e.delegator == delegator &&
                                e.additionalAmount == 1000 &&
                                e.bondedAmount == 3000,
                            "Bond event not emitted correctly"
                        )
                    })

                    describe("new delegate is registered transcoder", () => {
                        it("should increase transcoder's total stake in pool with current bonded stake + provided amount", async () => {
                            const startTranscoderTotalStake = await bondingManager.transcoderTotalStake(transcoder1)
                            await bondingManager.bond(1000, transcoder1, {from: delegator})
                            const endTranscoderTotalStake = await bondingManager.transcoderTotalStake(transcoder1)

                            assert.equal(endTranscoderTotalStake.sub(startTranscoderTotalStake), 3000, "wrong change in transcoder total stake")
                        })

                        describe("old delegate is registered transcoder", () => {
                            it("should only increase next total stake by additional bonded stake", async () => {
                                const startNextTotalStake = await bondingManager.nextRoundTotalActiveStake()
                                await bondingManager.bond(1000, transcoder1, {from: delegator})
                                const endNextTotalStake = await bondingManager.nextRoundTotalActiveStake()

                                assert.equal(endNextTotalStake.sub(startNextTotalStake), 1000, "wrong change in next total stake")
                            })
                        })

                        describe("old delegate is not registered transcoder", () => {
                            it("should increase next total stake by current bonded stake + additional bonded stake", async () => {
                                // Delegate to non-transcoder
                                await bondingManager.bond(0, nonTranscoder, {from: delegator})

                                const bondedAmount = (await bondingManager.getDelegator(delegator))[0].toNumber()
                                const startNextTotalStake = await bondingManager.nextRoundTotalActiveStake()
                                await bondingManager.bond(1000, transcoder1, {from: delegator})
                                const endNextTotalStake = await bondingManager.nextRoundTotalActiveStake()

                                assert.equal(endNextTotalStake.sub(startNextTotalStake), bondedAmount + 1000, "wrong change in next total stake")
                            })
                        })
                    })

                    describe("new delegate is not registered transcoder", () => {
                        describe("old delegate is registered transcoder", () => {
                            it("should decrease next total stake by current bonded stake (no additional bonded stake counted)", async () => {
                                const bondedAmount = (await bondingManager.getDelegator(delegator))[0].toNumber()
                                const startNextTotalStake = await bondingManager.nextRoundTotalActiveStake()
                                await bondingManager.bond(1000, nonTranscoder, {from: delegator})
                                const endNextTotalStake = await bondingManager.nextRoundTotalActiveStake()

                                assert.equal(startNextTotalStake.sub(endNextTotalStake), bondedAmount, "wrong change in next total stake")
                            })
                        })

                        describe("old delegate is not registered transcoder", () => {
                            beforeEach(async () => {
                                // Delegate to non-transcoder
                                await bondingManager.bond(0, nonTranscoder, {from: delegator})
                            })


                            it("should not decrease the total stake for the next round", async () => {
                                const startTotalStake = await bondingManager.nextRoundTotalActiveStake()
                                await bondingManager.bond(1000, nonTranscoder, {from: delegator})
                                const endTotalStake = await bondingManager.nextRoundTotalActiveStake()
                                assert.equal(endTotalStake.sub(startTotalStake).toString(), 0, "wrong change in total next round stake")
                            })
                        })
                    })

                    describe("old delegate is registered transcoder", () => {
                        it("should decrease transcoder's total stake in pool by current bonded stake", async () => {
                            const startTranscoderTotalStake = await bondingManager.transcoderTotalStake(transcoder0)
                            await bondingManager.bond(1000, transcoder1, {from: delegator})
                            const endTranscoderTotalStake = await bondingManager.transcoderTotalStake(transcoder0)

                            assert.equal(startTranscoderTotalStake.sub(endTranscoderTotalStake), 2000, "wrong change in transcoder total stake")
                        })
                    })
                })
            })

            describe("caller is increasing bonded amount", () => {
                it("should fail if provided amount = 0", async () => {
                    await expectRevertWithReason(bondingManager.bond(0, transcoder0, {from: delegator}), "delegation amount must be greater than 0")
                })

                it("should update bonded amount", async () => {
                    const startBondedAmount = (await bondingManager.getDelegator(delegator))[0]
                    await bondingManager.bond(1000, transcoder0, {from: delegator})
                    const endBondedAmount = (await bondingManager.getDelegator(delegator))[0]

                    assert.equal(endBondedAmount.sub(startBondedAmount), 1000, "wrong change in bondedAmount")
                })

                describe("delegate is registered transcoder", () => {
                    it("should increase the total stake for the next round", async () => {
                        const startTotalStake = await bondingManager.nextRoundTotalActiveStake()
                        await bondingManager.bond(1000, transcoder0, {from: delegator})
                        const endTotalStake = await bondingManager.nextRoundTotalActiveStake()
                        assert.equal(endTotalStake.sub(startTotalStake), 1000, "wrong change in nextRoundTotalActiveStake")
                    })
                })

                describe("delegate is not registered transcoder", () => {
                    beforeEach(async () => {
                        // Delegate to a non-transcoder i.e. self
                        await bondingManager.bond(0, nonTranscoder, {from: delegator})
                    })

                    it("should not change the total active stake for next round", async () => {
                        const startTotalActiveStake = await bondingManager.nextRoundTotalActiveStake()
                        await bondingManager.bond(1000, nonTranscoder, {from: delegator})
                        const endTotalActiveStake = await bondingManager.nextRoundTotalActiveStake()
                        assert.equal(endTotalActiveStake.sub(startTotalActiveStake), 0, "wrong change in nextRoundTotalActiveStake")
                    })
                })

                it("should fire a Bond event when increasing bonded amount", async () => {
                    const txRes = await bondingManager.bond(1000, transcoder0, {from: delegator})
                    truffleAssert.eventEmitted(
                        txRes,
                        "Bond",
                        e => e.newDelegate == transcoder0 &&
                            e.oldDelegate == transcoder0 &&
                            e.delegator == delegator &&
                            e.additionalAmount == 1000 &&
                            e.bondedAmount == 3000,
                        "Bond event not emitted correctly"
                    )
                })
            })
        })

        describe("set delegate earnings pool factors if not initialized", () => {
            it("sets cumulativeRewardFactor if value is zero", async () => {
                await bondingManager.bond(100, transcoder0, {from: delegator})
                await bondingManager.reward({from: transcoder1})

                const ep0 = await bondingManager.getTranscoderEarningsPoolForRound(transcoder1, currentRound)

                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
                await bondingManager.bond(100, transcoder1, {from: delegator})

                const ep1 =  await bondingManager.getTranscoderEarningsPoolForRound(transcoder1, currentRound + 1)

                assert.notEqual(ep0.cumulativeRewardFactor.toString(), "0")
                assert.equal(ep0.cumulativeRewardFactor.toString(), ep1.cumulativeRewardFactor.toString())
            })

            it("sets cumulativeFeeFactor if value is zero", async () => {
                await bondingManager.bond(100, transcoder0, {from: delegator})
                await fixture.ticketBroker.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "updateTranscoderWithFees(address,uint256,uint256)",
                        ["address", "uint256", "uint256"],
                        [transcoder1, "1000000000000000000", currentRound]
                    )
                )

                const ep0 = await bondingManager.getTranscoderEarningsPoolForRound(transcoder1, currentRound)

                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
                await bondingManager.bond(100, transcoder1, {from: delegator})

                const ep1 =  await bondingManager.getTranscoderEarningsPoolForRound(transcoder1, currentRound + 1)

                assert.notEqual(ep0.cumulativeFeeFactor.toString(), "0")
                assert.equal(ep0.cumulativeFeeFactor.toString(), ep1.cumulativeFeeFactor.toString())
            })            
        })
    })

    describe("unbond", () => {
        const transcoder = accounts[0]
        const delegator = accounts[1]
        const delegator2 = accounts[2]
        const currentRound = 100

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)

            await bondingManager.bond(1000, transcoder, {from: transcoder})
            await bondingManager.transcoder(5, 10, {from: transcoder})

            await bondingManager.bond(1000, transcoder, {from: delegator})
            await bondingManager.bond(1000, delegator, {from: delegator2})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
            await fixture.roundsManager.execute(bondingManager.address, functionSig("setCurrentRoundTotalActiveStake()"))
        })

        it("should fail if current round is not initialized", async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), false)

            await expectRevertWithReason(bondingManager.unbond(500, {from: delegator}), "current round is not initialized")
        })

        it("should fail if the caller is not bonded", async () => {
            await bondingManager.unbond(1000, {from: delegator})

            // This should fail because caller is already unbonded and not bonded
            await expectRevertWithReason(bondingManager.unbond(500, {from: delegator}), "caller must be bonded")
        })

        it("should fail if amount is 0", async () => {
            await expectRevertWithReason(bondingManager.unbond(0, {from: delegator}), "unbond amount must be greater than 0")
        })

        it("should fail if amount is greater than bonded amount", async () => {
            await expectRevertWithReason(bondingManager.unbond(1001, {from: delegator}), "amount is greater than bonded amount")
        })

        it("should update current earningsPool totalStake when lastActiveStakeUpdateRound < currentRound", async () => {
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 2)
            assert.isBelow((await bondingManager.getTranscoder(transcoder)).lastActiveStakeUpdateRound.toNumber(), currentRound + 2)

            await bondingManager.unbond(1000, {from: delegator})

            const lastActiveStake = (await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 1)).totalStake
            const pool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 2)
            assert.equal(pool.totalStake.toString(), lastActiveStake.toString())
        })

        it("should not update current earningsPool totalStake when lastActiveStakeUpdateRound = currentRound", async () => {
            assert.equal((await bondingManager.getTranscoder(transcoder)).lastActiveStakeUpdateRound.toNumber(), currentRound + 1)

            const startActiveStake = (await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 1)).totalStake
            await bondingManager.unbond(1000, {from: delegator})
            const endActiveStake = (await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 1)).totalStake

            assert.equal(startActiveStake.toString(), endActiveStake.toString())
        })

        it("should not update current earningsPool totalStake when lastActiveStakeUpdateRound > currentRound", async () => {
            await bondingManager.unbond(500, {from: delegator})
            assert.isAbove((await bondingManager.getTranscoder(transcoder)).lastActiveStakeUpdateRound.toNumber(), currentRound + 1)

            const startActiveStake = (await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 1)).totalStake
            await bondingManager.unbond(500, {from: delegator})
            const endActiveStake = (await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 1)).totalStake

            assert.equal(startActiveStake.toString(), endActiveStake.toString())
        })

        describe("partial unbonding", () => {
            it("should create an unbonding lock for a partial unbond", async () => {
                const unbondingLockID = (await bondingManager.getDelegator(delegator))[6]
                const unbondingPeriod = (await bondingManager.unbondingPeriod.call()).toNumber()

                await bondingManager.unbond(500, {from: delegator})

                const lock = await bondingManager.getDelegatorUnbondingLock(delegator, unbondingLockID)
                assert.equal(lock[0], 500, "wrong unbonding lock amount")
                assert.equal(lock[1], currentRound + 1 + unbondingPeriod, "wrong unbonding lock withdraw round")

                const dInfo = await bondingManager.getDelegator(delegator)
                assert.equal(dInfo[0], 500, "wrong delegator bonded amount")
                assert.equal(dInfo[6], unbondingLockID.toNumber() + 1, "wrong delegator next unbonding lock ID")

                const tInfo = await bondingManager.getDelegator(transcoder)
                assert.equal(tInfo[3], 1500, "wrong delegate delegated amount")

                assert.equal(await bondingManager.delegatorStatus(delegator), constants.DelegatorStatus.Bonded, "wrong delegator status")
            })

            it("should fire an Unbond event with an unbonding lock representing a partial unbond", async () => {
                const unbondingLockID = (await bondingManager.getDelegator(delegator))[6]
                const unbondingPeriod = (await bondingManager.unbondingPeriod.call()).toNumber()

                const txRes = await bondingManager.unbond(500, {from: delegator})
                truffleAssert.eventEmitted(
                    txRes,
                    "Unbond",
                    e => e.delegate == transcoder &&
                        e.delegator == delegator &&
                        e.unbondingLockId == unbondingLockID.toNumber() &&
                        e.amount == 500 &&
                        e.withdrawRound == currentRound + 1 + unbondingPeriod,
                    "Unbond event not emitted correctly"
                )
            })

            describe("delegated to non-transcoder", () => {
                it("should not change total active stake for the next round", async () => {
                    const startTotalActiveStake = await bondingManager.nextRoundTotalActiveStake()
                    await bondingManager.unbond(500, {from: delegator2})
                    const endTotalActiveStake = await bondingManager.nextRoundTotalActiveStake()
                    assert.equal(endTotalActiveStake.sub(startTotalActiveStake), 0, "wrong change in nextRoundTotalActiveStake")
                })

                it("should not change delegate's lastActiveStakeUpdateRound", async () => {
                    await bondingManager.unbond(500, {from: delegator2})
                    assert.equal((await bondingManager.getTranscoder(delegator)).lastActiveStakeUpdateRound, 0)
                })
            })

            describe("not delegated to self and delegate is registered transcoder", () => {
                it("should decrease delegated transcoder's delegated stake in pool", async () => {
                    // Caller is delegator delegated to registered transcoder (not self)
                    await bondingManager.unbond(500, {from: delegator})

                    assert.equal(await bondingManager.transcoderTotalStake(transcoder), 1500, "wrong transcoder total stake")
                })

                it("should decrease the total stake for the next round", async () => {
                    const startTotalStake = await bondingManager.nextRoundTotalActiveStake()
                    await bondingManager.unbond(500, {from: delegator})
                    const endTotalStake = await bondingManager.nextRoundTotalActiveStake()
                    assert.equal(startTotalStake.sub(endTotalStake), 500, "wrong change in total next round stake")
                })

                it("should update delegate's lastActiveStakeUpdateRound", async () => {
                    await bondingManager.unbond(500, {from: delegator})
                    assert.equal((await bondingManager.getTranscoder(transcoder)).lastActiveStakeUpdateRound, currentRound + 2)
                })
            })

            describe("delegated to self with non-zero bonded amount and is registered transcoder", () => {
                it("should decrease delegated transcoder's (self) delegated stake in pool", async () => {
                    // Caller is transcoder delegated to self
                    await bondingManager.unbond(500, {from: transcoder})

                    assert.equal(await bondingManager.transcoderTotalStake(transcoder), 1500, "wrong transcoder total stake")
                })

                it("should decrease the total stake for the next round", async () => {
                    const startTotalStake = await bondingManager.nextRoundTotalActiveStake()
                    await bondingManager.unbond(500, {from: transcoder})
                    const endTotalStake = await bondingManager.nextRoundTotalActiveStake()
                    assert.equal(startTotalStake.sub(endTotalStake), 500, "wrong change in total next round stake")
                })

                it("should update delegate's lastActiveStakeUpdateRound", async () => {
                    await bondingManager.unbond(500, {from: delegator})
                    assert.equal((await bondingManager.getTranscoder(transcoder)).lastActiveStakeUpdateRound, currentRound + 2)
                })
            })
        })

        describe("full unbonding", () => {
            it("should create an unbonding lock for a full unbond", async () => {
                const unbondingLockID = (await bondingManager.getDelegator(delegator))[6]
                const unbondingPeriod = (await bondingManager.unbondingPeriod.call()).toNumber()

                await bondingManager.unbond(1000, {from: delegator})

                const lock = await bondingManager.getDelegatorUnbondingLock(delegator, unbondingLockID)
                assert.equal(lock[0], 1000, "wrong unbonding lock amount")
                assert.equal(lock[1], currentRound + 1 + unbondingPeriod, "wrong unbonding lock withdraw round")

                const dInfo = await bondingManager.getDelegator(delegator)
                assert.equal(dInfo[0], 0, "wrong delegator bonded amount")
                assert.equal(dInfo[2], constants.NULL_ADDRESS, "wrong delegate address")
                assert.equal(dInfo[4], 0, "wrong start round")

                assert.equal(await bondingManager.delegatorStatus(delegator), constants.DelegatorStatus.Unbonded, "wrong delegator status")
            })

            it("should fire an Unbond event with an unbonding lock representing a full unbond", async () => {
                const unbondingLockID = (await bondingManager.getDelegator(delegator))[6]
                const unbondingPeriod = (await bondingManager.unbondingPeriod.call()).toNumber()

                const txRes = await bondingManager.unbond(1000, {from: delegator})
                truffleAssert.eventEmitted(
                    txRes,
                    "Unbond",
                    e => e.delegate == transcoder &&
                        e.delegator == delegator &&
                        e.unbondingLockId == unbondingLockID.toNumber() &&
                        e.amount == 1000 &&
                        e.withdrawRound == currentRound + 1 + unbondingPeriod,
                    "Unbond event not emitted correctly"
                )
            })

            describe("is an active transcoder", () => {
                it("should resign as a transcoder", async () => {
                    // Caller is transcoder delegated to self
                    await bondingManager.unbond(1000, {from: transcoder})

                    assert.isFalse(await bondingManager.isRegisteredTranscoder(transcoder), "wrong transcoder status")
                })

                it("should decrease the total stake for the next round", async () => {
                    const startTotalStake = await bondingManager.nextRoundTotalActiveStake()
                    await bondingManager.unbond(1000, {from: transcoder})
                    const endTotalStake = await bondingManager.nextRoundTotalActiveStake()
                    // Decrease by 2000 (delegated stake) instead of just 1000 (own bonded stake)
                    assert.equal(startTotalStake.sub(endTotalStake), 2000, "wrong change in total next round stake")
                })

                it("sets transcoder's deactivation round to next round", async () => {
                    await bondingManager.unbond(1000, {from: transcoder})
                    assert.equal((await bondingManager.getTranscoder(transcoder)).deactivationRound, currentRound + 2)
                })

                it("should fire a TranscoderDeactivated event", async () => {
                    const txRes = await bondingManager.unbond(1000, {from: transcoder})
                    truffleAssert.eventEmitted(
                        txRes,
                        "TranscoderDeactivated",
                        e => e.transcoder == transcoder && e.deactivationRound == currentRound + 2,
                        "TranscoderDeactivated event not emitted correctly"
                    )
                })
            })

            describe("is not an active transcoder", () => {
                it("should not update total active stake for the next round", async () => {
                    const startTotalStake = await bondingManager.nextRoundTotalActiveStake()
                    await bondingManager.unbond(1000, {from: delegator2})
                    const endTotalStake = await bondingManager.nextRoundTotalActiveStake()
                    assert.equal(startTotalStake.sub(endTotalStake), 0, "wrong change in total next round stake")
                })
            })
        })
    })

    describe("rebond", () => {
        const transcoder = accounts[0]
        const transcoder1 = accounts[1]
        const transcoder2 = accounts[2]
        const nonTranscoder = accounts[3]
        const delegator = accounts[4]
        const currentRound = 100
        const unbondingLockID = 0

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)

            await bondingManager.bond(1000, transcoder, {from: transcoder})
            await bondingManager.transcoder(5, 10, {from: transcoder})
            await bondingManager.bond(1000, transcoder, {from: delegator})
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)

            await bondingManager.unbond(500, {from: delegator})
        })

        it("should fail if system is paused", async () => {
            await fixture.controller.pause()

            await expectRevertWithReason(bondingManager.rebond(unbondingLockID, {from: delegator}), "system is paused")
        })

        it("should fail if current round is not initialized", async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), false)

            await expectRevertWithReason(bondingManager.rebond(unbondingLockID, {from: delegator}), "current round is not initialized")
        })

        it("should fail if delegator is not in the Bonded or Pending state", async () => {
            // Unbond the rest of the delegator's tokens so it is no longer has any bonded tokens
            await bondingManager.unbond(500, {from: delegator})

            await expectRevertWithReason(bondingManager.rebond(unbondingLockID, {from: delegator}), "caller must be bonded")
        })

        it("should fail for invalid unbonding lock ID", async () => {
            // Unbonding lock for ID does not exist
            await expectRevertWithReason(bondingManager.rebond(unbondingLockID + 5, {from: delegator}), "invalid unbonding lock ID")
        })

        it("should rebond tokens for unbonding lock to delegator's current delegate", async () => {
            await bondingManager.rebond(unbondingLockID, {from: delegator})

            const dInfo = await bondingManager.getDelegator(delegator)
            assert.equal(dInfo[0], 1000, "wrong delegator bonded amount")

            const tDInfo = await bondingManager.getDelegator(transcoder)
            assert.equal(tDInfo[3], 2000, "wrong delegate delegated amount")

            const lock = await bondingManager.getDelegatorUnbondingLock(delegator, unbondingLockID)
            assert.equal(lock[0], 0, "wrong lock amount should be 0")
            assert.equal(lock[1], 0, "wrong lock withdrawRound should be 0")
        })

        describe("current delegate is a registered transcoder", () => {
            it("should increase transcoder's delegated stake in pool", async () => {
                await bondingManager.rebond(unbondingLockID, {from: delegator})

                assert.equal(await bondingManager.transcoderTotalStake(transcoder), 2000, "wrong transcoder total stake")
            })

            it("should increase total active stake for the next round", async () => {
                const startTotalActiveStake = await bondingManager.nextRoundTotalActiveStake()
                await bondingManager.rebond(unbondingLockID, {from: delegator})
                const endTotalActiveStake = await bondingManager.nextRoundTotalActiveStake()
                assert.equal(endTotalActiveStake.sub(startTotalActiveStake), 500, "wrong change in nextRoundTotalActiveStake")
            })

            it("should update delegate's lastActiveStakeUpdateRound", async () => {
                await bondingManager.rebond(unbondingLockID, {from: delegator})
                assert.equal((await bondingManager.getTranscoder(transcoder)).lastActiveStakeUpdateRound, currentRound + 2)
            })

            it("should evict when rebonding and pool is full", async () => {
                await bondingManager.bond(1900, transcoder1, {from: transcoder1})
                await bondingManager.transcoder(5, 10, {from: transcoder1})
                await bondingManager.bond(1800, transcoder2, {from: transcoder2})
                await bondingManager.transcoder(5, 10, {from: transcoder2})

                const txRes = await bondingManager.rebond(unbondingLockID, {from: delegator})
                truffleAssert.eventEmitted(
                    txRes,
                    "TranscoderDeactivated",
                    e => e.transcoder == transcoder2 && e.deactivationRound == currentRound + 2,
                    "TranscoderDeactivated event not emitted correctly"
                )

                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 2)
                assert.isTrue(await bondingManager.isActiveTranscoder(transcoder))
                // Check that transcoder2's deactivation round is the next round
                assert.equal((await bondingManager.getTranscoder(transcoder2)).deactivationRound, currentRound + 2)
                const pool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 2)
                assert.equal(pool.totalStake.toNumber(), 2000)
            })
        })

        describe("current delegate is not a registered transcoder", () => {
            beforeEach(async () => {
                // Delegate to a non-transcoder i.e. self
                await bondingManager.bond(0, nonTranscoder, {from: delegator})
            })

            it("should not change total active stake for the next round", async () => {
                const startTotalActiveStake = await bondingManager.nextRoundTotalActiveStake()
                await bondingManager.rebond(unbondingLockID, {from: delegator})
                const endTotalActiveStake = await bondingManager.nextRoundTotalActiveStake()
                assert.equal(endTotalActiveStake.sub(startTotalActiveStake), 0, "wrong change in nextRoundTotalActiveStake")
            })

            it("should not update delegate's lastActiveStakeUpdateRound", async () => {
                await bondingManager.rebond(unbondingLockID, {from: delegator})
                assert.equal((await bondingManager.getTranscoder(nonTranscoder)).lastActiveStakeUpdateRound, 0)
            })
        })

        it("should create an Rebond event", async () => {
            const txRes = await bondingManager.rebond(unbondingLockID, {from: delegator})
            truffleAssert.eventEmitted(
                txRes,
                "Rebond",
                e => e.delegate == transcoder &&
                    e.delegator == delegator &&
                    e.unbondingLockId == unbondingLockID &&
                    e.amount == 500,
                "Rebond event not emitted correctly"
            )
        })
    })

    describe("rebondFromUnbonded", () => {
        const transcoder = accounts[0]
        const delegator = accounts[1]
        const nonTranscoder = accounts[3]
        const currentRound = 100
        const unbondingLockID = 0

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)

            await bondingManager.bond(1000, transcoder, {from: transcoder})
            await bondingManager.transcoder(5, 10, {from: transcoder})
            await bondingManager.bond(1000, transcoder, {from: delegator})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
            await bondingManager.unbond(500, {from: delegator})
        })

        it("should fail if system is paused", async () => {
            // Delegator unbonds rest of tokens transitioning to the Unbonded state
            await bondingManager.unbond(500, {from: delegator})
            await fixture.controller.pause()

            await expectRevertWithReason(
                bondingManager.rebondFromUnbonded(transcoder, unbondingLockID, {from: delegator}),
                "system is paused"
            )
        })

        it("should fail if current round is not initialized", async () => {
            // Delegator unbonds rest of tokens transitioning to the Unbonded state
            await bondingManager.unbond(500, {from: delegator})
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), false)

            await expectRevertWithReason(bondingManager.rebondFromUnbonded(transcoder, unbondingLockID, {from: delegator}), "current round is not initialized")
        })

        it("should fail if delegator is not in Unbonded state", async () => {
            await expectRevertWithReason(bondingManager.rebondFromUnbonded(transcoder, unbondingLockID, {from: delegator}), "caller must be unbonded")
        })

        it("should fail for invalid unbonding lock ID", async () => {
            // Delegator unbonds rest of tokens transitioning to the Unbonded state
            await bondingManager.unbond(500, {from: delegator})

            // Unbonding lock for ID does not exist
            await expectRevertWithReason(bondingManager.rebondFromUnbonded(transcoder, unbondingLockID + 5, {from: delegator}), "invalid unbonding lock ID")
        })

        it("should set delegator's start round and delegate address", async () => {
            // Delegator unbonds rest of tokens transitioning to the Unbonded state
            await bondingManager.unbond(500, {from: delegator})

            await bondingManager.rebondFromUnbonded(transcoder, unbondingLockID, {from: delegator})

            const dInfo = await bondingManager.getDelegator(delegator)
            assert.equal(dInfo[2], transcoder, "wrong delegate address")
            assert.equal(dInfo[4], currentRound + 2, "wrong start round")
        })

        it("should rebond tokens for unbonding lock to new delegate", async () => {
            // Delegator unbonds rest of tokens transitioning to the Unbonded state
            await bondingManager.unbond(500, {from: delegator})

            await bondingManager.rebondFromUnbonded(transcoder, unbondingLockID, {from: delegator})

            const dInfo = await bondingManager.getDelegator(delegator)
            assert.equal(dInfo[0], 500, "wrong delegator bonded amount")

            const tDInfo = await bondingManager.getDelegator(transcoder)
            assert.equal(tDInfo[3], 1500, "wrong delegate delegated amount")

            const lock = await bondingManager.getDelegatorUnbondingLock(delegator, unbondingLockID)
            assert.equal(lock[0], 0, "wrong lock amount should be 0")
            assert.equal(lock[1], 0, "wrong lock withdrawRound should be 0")
        })

        describe("new delegate is a registered transcoder", () => {
            beforeEach(async () => {
                // Delegator unbonds rest of tokens transitioning to the Unbonded state
                await bondingManager.unbond(500, {from: delegator})
            })
            it("should increase transcoder's delegated stake in pool", async () => {
                await bondingManager.rebondFromUnbonded(transcoder, unbondingLockID, {from: delegator})
                assert.equal(await bondingManager.transcoderTotalStake(transcoder), 1500, "wrong transcoder total stake")
            })

            it("should increase the total active stake for the next round", async () => {
                const startTotalActiveStake = await bondingManager.nextRoundTotalActiveStake()
                await bondingManager.rebondFromUnbonded(transcoder, unbondingLockID, {from: delegator})
                const endTotalActiveStake = await bondingManager.nextRoundTotalActiveStake()
                assert.equal(endTotalActiveStake.sub(startTotalActiveStake), 500, "wrong change in nextRoundTotalActiveStake")
            })

            it("should update delegate's lastActiveStakeUpdateRound", async () => {
                await bondingManager.rebondFromUnbonded(transcoder, unbondingLockID, {from: delegator})
                assert.equal((await bondingManager.getTranscoder(transcoder)).lastActiveStakeUpdateRound, currentRound + 2)
            })
        })

        describe("new delegate is not a registered transcoder", () => {
            beforeEach(async () => {
                // Delegator unbonds rest of tokens transitioning to the Unbonded state
                // 500 is unbonded from transcoder in the active pool
                await bondingManager.unbond(500, {from: delegator})
            })

            it("should not change the total active stake for the next round", async () => {
                const startTotalActiveStake = await bondingManager.nextRoundTotalActiveStake()
                await bondingManager.rebondFromUnbonded(nonTranscoder, unbondingLockID, {from: delegator})
                const endTotalActiveStake = await bondingManager.nextRoundTotalActiveStake()
                assert.equal(endTotalActiveStake.sub(startTotalActiveStake), 0, "wrong change in nextRoundTotalActiveStake")
            })

            it("should not update delegate's lastActiveStakeUpdateRound", async () => {
                await bondingManager.rebondFromUnbonded(nonTranscoder, unbondingLockID, {from: delegator})
                assert.equal((await bondingManager.getTranscoder(nonTranscoder)).lastActiveStakeUpdateRound, 0)
            })
        })

        it("should create a Rebond event", async () => {
            // Delegator unbonds rest of tokens transitioning to the Unbonded state
            await bondingManager.unbond(500, {from: delegator})

            const txRes = await bondingManager.rebondFromUnbonded(transcoder, unbondingLockID, {from: delegator})
            truffleAssert.eventEmitted(
                txRes,
                "Rebond",
                e => e.delegate == transcoder &&
                    e.delegator == delegator &&
                    e.unbondingLockId == unbondingLockID &&
                    e.amount == 500,
                "Rebond event not emitted correctly"
            )
        })
    })

    describe("withdrawStake", () => {
        const transcoder = accounts[0]
        const delegator = accounts[1]
        const currentRound = 100
        const unbondingLockID = 0

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)

            await bondingManager.bond(1000, transcoder, {from: transcoder})
            await bondingManager.transcoder(5, 10, {from: transcoder})
            await bondingManager.bond(1000, transcoder, {from: delegator})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
            await bondingManager.unbond(500, {from: delegator})
        })

        it("should fail if system is paused", async () => {
            await fixture.controller.pause()

            await expectRevertWithReason(bondingManager.withdrawStake(unbondingLockID, {from: delegator}), "system is paused")
        })

        it("should fail if current round is not initialized", async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), false)

            await expectRevertWithReason(bondingManager.withdrawStake(unbondingLockID, {from: delegator}), "current round is not initialized")
        })

        it("should fail if unbonding lock is invalid", async () => {
            // Unbonding lock for ID does not exist
            await expectRevertWithReason(bondingManager.withdrawStake(unbondingLockID + 5, {from: delegator}), "invalid unbonding lock ID")
        })

        it("should fail if unbonding lock withdraw round is in the future", async () => {
            await expectRevertWithReason(bondingManager.withdrawStake(unbondingLockID, {from: delegator}), "withdraw round must be before or equal to the current round")
        })

        it("should withdraw tokens for unbonding lock", async () => {
            const unbondingPeriod = (await bondingManager.unbondingPeriod.call()).toNumber()
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1 + unbondingPeriod)

            await bondingManager.withdrawStake(unbondingLockID, {from: delegator})

            const lock = await bondingManager.getDelegatorUnbondingLock(delegator, unbondingLockID)
            assert.equal(lock[0], 0, "wrong lock amount should be 0")
            assert.equal(lock[1], 0, "wrong lock withdrawRound should be 0")
        })

        it("should create an WithdrawStake event", async () => {
            const unbondingPeriod = (await bondingManager.unbondingPeriod.call()).toNumber()
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1 + unbondingPeriod)

            const txRes = await bondingManager.withdrawStake(unbondingLockID, {from: delegator})
            truffleAssert.eventEmitted(
                txRes,
                "WithdrawStake",
                e => e.delegator == delegator &&
                    e.unbondingLockId == unbondingLockID &&
                    e.amount == 500 &&
                    e.withdrawRound == currentRound + 1 + unbondingPeriod,
                "WithdrawStake event not emitted correctly"
            )
        })
    })

    describe("withdrawFees", () => {
        const transcoder0 = accounts[0]
        const transcoder1 = accounts[1]
        const currentRound = 100

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)

            await bondingManager.bond(1000, transcoder0, {from: transcoder0})
            await bondingManager.transcoder(5, 10, {from: transcoder0})
            await bondingManager.bond(1000, transcoder1, {from: transcoder1})
            await bondingManager.transcoder(5, 10, {from: transcoder1})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder0, 1000, currentRound + 1]
                )
            )
        })

        it("should fail if system is paused", async () => {
            await fixture.controller.pause()

            await expectRevertWithReason(bondingManager.withdrawFees({from: transcoder0}), "system is paused")
        })

        it("should fail if current round is not initialized", async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), false)

            await expectRevertWithReason(bondingManager.withdrawFees({from: transcoder0}), "current round is not initialized")
        })

        it("should fail if there are no fees to withdraw", async () => {
            await expectRevertWithReason(bondingManager.withdrawFees({from: transcoder1}), "no fees to withdraw")
        })

        it("should withdraw caller's fees", async () => {
            await bondingManager.claimEarnings(currentRound + 1, {from: transcoder0})
            assert.isAbove((await bondingManager.getDelegator(transcoder0))[1].toNumber(), 0, "caller should have non-zero fees")

            await bondingManager.withdrawFees({from: transcoder0})

            const dInfo = await bondingManager.getDelegator(transcoder0)
            assert.equal(dInfo[5], currentRound + 1, "should set caller's lastClaimRound")
            assert.equal(dInfo[1], 0, "should set caller's fees to zero")
        })
    })

    describe("reward", () => {
        const transcoder = accounts[0]
        const nonTranscoder = accounts[1]
        const currentRound = 100

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)

            await bondingManager.bond(1000, transcoder, {from: transcoder})
            await bondingManager.transcoder(50 * PERC_MULTIPLIER, 10, {from: transcoder})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
            await fixture.minter.setMockUint256(functionSig("createReward(uint256,uint256)"), 1000)
        })

        it("should fail if system is paused", async () => {
            await fixture.controller.pause()

            await expectRevertWithReason(bondingManager.reward({from: transcoder}), "system is paused")
        })

        it("should fail if current round is not initialized", async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), false)

            await expectRevertWithReason(bondingManager.reward({from: transcoder}), "current round is not initialized")
        })

        it("should fail if caller is not an active transcoder for the current round", async () => {
            await expectRevertWithReason(bondingManager.reward({from: nonTranscoder}), "caller must be an active transcoder")
        })

        it("should fail if caller already called reward during the current round", async () => {
            await bondingManager.reward({from: transcoder})
            // This should fail because transcoder already called reward during the current round
            await expectRevertWithReason(bondingManager.reward({from: transcoder}), "caller has already called reward for the current round")
        })

        it("should update caller with rewards", async () => {
            const startDelegatedAmount = (await bondingManager.getDelegator(transcoder))[3]
            const startTotalStake = await bondingManager.transcoderTotalStake(transcoder)
            const startNextTotalStake = await bondingManager.nextRoundTotalActiveStake()
            await bondingManager.reward({from: transcoder})
            const endDelegatedAmount = (await bondingManager.getDelegator(transcoder))[3]
            const endTotalStake = await bondingManager.transcoderTotalStake(transcoder)
            const endNextTotalStake = await bondingManager.nextRoundTotalActiveStake()

            const earningsPool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 1)
            const expRewardFactor = 1 * PERC_DIVISOR + 500 * PERC_DIVISOR / 1000
            assert.equal(earningsPool.cumulativeRewardFactor.toString(), expRewardFactor.toString(), "should update cumulativeRewardFactor in earningsPool")

            assert.equal(endDelegatedAmount.sub(startDelegatedAmount), 1000, "should update delegatedAmount with new rewards")
            assert.equal(endTotalStake.sub(startTotalStake), 1000, "should update transcoder's total stake in the pool with new rewards")
            assert.equal(endNextTotalStake.sub(startNextTotalStake), 1000, "should update next total stake with new rewards")
        })

        it("should update caller with rewards if lastActiveStakeUpdateRound < currentRound", async () => {
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 3)
            const startDelegatedAmount = (await bondingManager.getDelegator(transcoder))[3]
            const startTotalStake = await bondingManager.transcoderTotalStake(transcoder)
            const startNextTotalStake = await bondingManager.nextRoundTotalActiveStake()
            await bondingManager.reward({from: transcoder})
            const endDelegatedAmount = (await bondingManager.getDelegator(transcoder))[3]
            const endTotalStake = await bondingManager.transcoderTotalStake(transcoder)
            const endNextTotalStake = await bondingManager.nextRoundTotalActiveStake()

            const earningsPool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 3)
            const expRewardFactor = 1 * PERC_DIVISOR + 500 * PERC_DIVISOR / 1000
            assert.equal(earningsPool.cumulativeRewardFactor.toString(), expRewardFactor.toString(), "should update cumulativeRewardFactor in earningsPool")

            assert.equal(endDelegatedAmount.sub(startDelegatedAmount), 1000, "should update delegatedAmount with new rewards")
            assert.equal(endTotalStake.sub(startTotalStake), 1000, "should update transcoder's total stake in the pool with new rewards")
            assert.equal(endNextTotalStake.sub(startNextTotalStake), 1000, "should update next total stake with new rewards")
        })

        it("should update caller's pendingStake if lastActiveStakeUpdateRound > currentRound when stake increases before reward call", async () => {
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 3)
            // Make sure that lastActiveStakeUpdateRound > currentRound
            await bondingManager.bond(1000, transcoder, {from: nonTranscoder})
            assert.isAbove((await bondingManager.getTranscoder(transcoder)).lastActiveStakeUpdateRound.toNumber(), currentRound + 3)

            const startPendingStake = await bondingManager.pendingStake(transcoder, currentRound + 3)
            await bondingManager.reward({from: transcoder})
            const endPendingStake = await bondingManager.pendingStake(transcoder, currentRound + 3)

            assert.isAbove(endPendingStake.toNumber(), startPendingStake.toNumber())
        })

        it("should update caller's pendingStake if lastActiveStakeUpdateRound > currentRound when stake decreases before reward call", async () => {
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 3)
            // Make sure that lastActiveStakeUpdateRound > currentRound
            await bondingManager.unbond(1, {from: transcoder})
            assert.isAbove((await bondingManager.getTranscoder(transcoder)).lastActiveStakeUpdateRound.toNumber(), currentRound + 3)

            const startPendingStake = await bondingManager.pendingStake(transcoder, currentRound + 3)
            await bondingManager.reward({from: transcoder})
            const endPendingStake = await bondingManager.pendingStake(transcoder, currentRound + 3)

            assert.equal(endPendingStake.toNumber(), startPendingStake.toNumber())
        })

        it("Should emit a Reward event", async () => {
            const txRes = await bondingManager.reward({from: transcoder})
            truffleAssert.eventEmitted(
                txRes,
                "Reward",
                e => e.transcoder == transcoder && e.amount == 1000,
                "Reward event not emitted correctly"
            )
        })
    })

    describe("updateTranscoderWithFees", () => {
        const transcoder = accounts[0]
        const nonTranscoder = accounts[1]
        const currentRound = 100

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)

            await bondingManager.bond(1000, transcoder, {from: transcoder})
            await bondingManager.transcoder(50 * PERC_MULTIPLIER, 50 * PERC_MULTIPLIER, {from: transcoder})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
        })

        it("should fail if system is paused", async () => {
            await fixture.controller.pause()

            await expectRevertWithReason(
                fixture.ticketBroker.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "updateTranscoderWithFees(address,uint256,uint256)",
                        ["address", "uint256", "uint256"],
                        [transcoder, 1000, currentRound + 1]
                    )
                ),
                "system is paused"
            )
        })

        it("should fail if caller is not TicketBroker", async () => {
            await expectRevertWithReason(bondingManager.updateTranscoderWithFees(transcoder, 1000, currentRound + 1), "caller must be TicketBroker")
        })

        it("should fail if transcoder is not registered", async () => {
            await expectRevertWithReason(
                fixture.ticketBroker.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "updateTranscoderWithFees(address,uint256,uint256)",
                        ["address", "uint256", "uint256"],
                        [nonTranscoder, 1000, currentRound + 1]
                    )
                ),
                "transcoder must be registered"
            )
        })

        it("should update transcoder's pendingFees when lastActiveStakeUpdateRound > currentRound when stake increases before function call", async () => {
            // Make sure that lastActiveStakeUpdateRound > currentRound
            await bondingManager.bond(1000, transcoder, {from: nonTranscoder})
            assert.isAbove((await bondingManager.getTranscoder(transcoder)).lastActiveStakeUpdateRound.toNumber(), currentRound + 1)

            const startPendingFees = await bondingManager.pendingFees(transcoder, currentRound + 1)

            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder, 1000, currentRound + 1]
                )
            )
            const endPendingFees = await bondingManager.pendingFees(transcoder, currentRound + 1)

            assert.isAbove(endPendingFees.toNumber(), startPendingFees.toNumber())
        })

        it("should update earningsPool cumulativeFeeFactor and transcoder cumulativeFees when transcoder hasn't called reward for current round", async () => {
            // set current cumulativeRewards to 500
            await fixture.minter.setMockUint256(functionSig("createReward(uint256,uint256)"), 1000)
            await bondingManager.reward()

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 2)

            let tr = await bondingManager.getTranscoder(transcoder)
            let cumulativeRewards = tr.cumulativeRewards
            assert.equal(cumulativeRewards.toString(), "500")

            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder, 1000, currentRound + 2]
                )
            )

            const earningsPool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 2)
            assert.equal(earningsPool.cumulativeFeeFactor.toString(), "375000", "wrong cumulativeFeeFactor")
            assert.equal(
                (await bondingManager.getTranscoder(transcoder)).cumulativeFees.toString(),
                "625"
            )
        })

        it("should update transcoder's pendingFees when lastActiveStakeUpdateRound > currentRound when stake decreases before function call", async () => {
            // Make sure that lastActiveStakeUpdateRound > currentRound
            await bondingManager.bond(1000, transcoder, {from: nonTranscoder})
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 2)
            await bondingManager.unbond(1, {from: nonTranscoder})
            assert.isAbove((await bondingManager.getTranscoder(transcoder)).lastActiveStakeUpdateRound.toNumber(), currentRound + 2)

            const startPendingFees = await bondingManager.pendingFees(transcoder, currentRound + 2)
            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder, 1000, currentRound + 2]
                )
            )
            const endPendingFees = await bondingManager.pendingFees(transcoder, currentRound + 2)

            assert.isAbove(endPendingFees.toNumber(), startPendingFees.toNumber())
        })

        it("should update transcoder cumulativeFees based on cumulativeRewards = 0 and if the transcoder claimed through the current round", async () => {
            // set current cumulativeRewards to 500
            await fixture.minter.setMockUint256(functionSig("createReward(uint256,uint256)"), 1000)
            await bondingManager.reward()

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 2)
            await bondingManager.claimEarnings(currentRound + 2, {from: transcoder})

            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder, 1000, currentRound + 2]
                )
            )
            const earningsPool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 2)
            assert.equal(earningsPool.cumulativeFeeFactor.toString(), "375000", "wrong cumulativeFeeFactor")
            assert.equal(
                (await bondingManager.getTranscoder(transcoder)).cumulativeFees.toString(),
                "500"
            )
        })

        it("should update transcoder's pendingFees when lastActiveStakeUpdateRound < currentRound", async () => {
            // Transcoder's active stake is set for currentRound + 1
            // Transcoder's active is not yet set for currentRound + 2
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 2)
            assert.isBelow((await bondingManager.getTranscoder(transcoder)).lastActiveStakeUpdateRound.toNumber(), currentRound + 2)

            const startPendingFees = await bondingManager.pendingFees(transcoder, currentRound + 2)

            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder, 1000, currentRound + 2]
                )
            )
            const endPendingFees = await bondingManager.pendingFees(transcoder, currentRound + 2)

            assert.isAbove(endPendingFees.toNumber(), startPendingFees.toNumber())
        })

        it("should update earningsPool cumulativeFeeFactor", async () => {
            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder, 1000, currentRound + 1]
                )
            )

            const earningsPool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 1)
            assert.equal(earningsPool.cumulativeFeeFactor.toString(), "500000", "wrong cumulativeFeeFactor")
        })

        it("should update transcoder with fees", async () => {
            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder, 1000, currentRound + 1]
                )
            )

            // set t.cumulativeFees to t.cumulativeFees + fees from fee cut and fees from staked rewards
            let tr = await bondingManager.getTranscoder(accounts[0])
            assert.equal(tr.cumulativeFees.toString(), "500", "should set transcoder's cumulativeFees to 1000")
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
                    [transcoder, 1000, round]
                )
            )
            assert.equal(
                (await bondingManager.getTranscoder(transcoder)).lastFeeRound.toNumber(),
                round
            )

            // Check when the _round param is < current round
            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder, 1000, round - 1]
                )
            )
            assert.equal(
                (await bondingManager.getTranscoder(transcoder)).lastFeeRound.toNumber(),
                round
            )

            // Check when the _round param is > current round
            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder, 1000, round + 1]
                )
            )
            assert.equal(
                (await bondingManager.getTranscoder(transcoder)).lastFeeRound.toNumber(),
                round
            )
        })
    })

    describe("slashTranscoder", () => {
        const transcoder = accounts[0]
        const transcoder1 = accounts[1]
        const finder = accounts[2]
        const nonTranscoder = accounts[3]
        const currentRound = 100

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)

            await bondingManager.bond(1000, transcoder, {from: transcoder})
            await bondingManager.transcoder(5, 10, {from: transcoder})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
            await fixture.roundsManager.execute(bondingManager.address, functionSig("setCurrentRoundTotalActiveStake()"))
        })

        it("should fail if system is paused", async () => {
            await fixture.controller.pause()

            await expectRevertWithReason(
                fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [transcoder, constants.NULL_ADDRESS, PERC_DIVISOR / 2, PERC_DIVISOR / 2]
                    )
                ),
                "system is paused"
            )
        })

        it("should fail if caller is not Verifier", async () => {
            await expectRevertWithReason(bondingManager.slashTranscoder(transcoder, constants.NULL_ADDRESS, PERC_DIVISOR / 2, PERC_DIVISOR / 2), "caller must be Verifier")
        })

        it("decreases transcoder's bondedAmount", async () => {
            const startBondedAmount = (await bondingManager.getDelegator(transcoder))[0].toNumber()
            await fixture.verifier.execute(
                bondingManager.address,
                functionEncodedABI(
                    "slashTranscoder(address,address,uint256,uint256)",
                    ["address", "uint256", "uint256", "uint256"],
                    [transcoder, constants.NULL_ADDRESS, PERC_DIVISOR / 2, 0]
                )
            )
            const endBondedAmount = (await bondingManager.getDelegator(transcoder))[0]

            assert.equal(endBondedAmount, startBondedAmount / 2, "should decrease transcoder's bondedAmount by slashAmount")
        })

        describe("transcoder is bonded", () => {
            it("updates delegated amount and next total stake tokens", async () => {
                const startNextTotalStake = await bondingManager.nextRoundTotalActiveStake()
                await fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [transcoder, constants.NULL_ADDRESS, PERC_DIVISOR / 2, 0]
                    )
                )
                const endNextTotalStake = await bondingManager.nextRoundTotalActiveStake()

                assert.equal((await bondingManager.getDelegator(transcoder))[3], 500, "should decrease delegatedAmount for transcoder by slash amount")
                assert.equal(startNextTotalStake.sub(endNextTotalStake), 1000, "should decrease next total stake tokens by transcoder's delegated stake")
            })
        })

        describe("transcoder has an unbonding lock", () => {
            beforeEach(async () => {
                await bondingManager.unbond(500, {from: transcoder})
            })

            it("still decreases transcoder's bondedAmount", async () => {
                const startBondedAmount = (await bondingManager.getDelegator(transcoder))[0].toNumber()
                await fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [transcoder, constants.NULL_ADDRESS, PERC_DIVISOR / 2, 0]
                    )
                )
                const endBondedAmount = (await bondingManager.getDelegator(transcoder))[0]

                assert.equal(endBondedAmount, startBondedAmount / 2, "should decrease transcoder's bondedAmount by slashAmount")
            })
        })

        describe("transcoder is active", () => {
            it("transcoder remains active until the next round", async () => {
                await fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [transcoder, constants.NULL_ADDRESS, PERC_DIVISOR / 2, 0]
                    )
                )
                assert.isOk(await bondingManager.isActiveTranscoder(transcoder), "should set active transcoder as inactive for the round")
            })

            it("deducts the transcoder's stake from the total for the next round", async () => {
                const startTotalActiveStake = await bondingManager.nextRoundTotalActiveStake()
                await fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [transcoder, constants.NULL_ADDRESS, PERC_DIVISOR / 2, 0]
                    )
                )
                const endTotalActiveStake = await bondingManager.nextRoundTotalActiveStake()
                assert.equal(startTotalActiveStake.sub(endTotalActiveStake).toNumber(), 1000, "should decrease total active stake by total stake of transcoder")
            })

            it("sets the transcoder's deactivation round to next round", async () => {
                await fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [transcoder, constants.NULL_ADDRESS, PERC_DIVISOR / 2, 0]
                    )
                )
                assert.equal((await bondingManager.getTranscoder(transcoder)).deactivationRound, currentRound + 2)
            })

            it("fires a TranscoderDeactivated event", async () => {
                const txRes = await fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [transcoder, constants.NULL_ADDRESS, PERC_DIVISOR / 2, 0]
                    )
                )
                truffleAssert.eventEmitted(
                    await truffleAssert.createTransactionResult(bondingManager, txRes.tx),
                    "TranscoderDeactivated",
                    e => e.transcoder == transcoder && e.deactivationRound == currentRound + 2,
                    "TranscoderDeactivated event not emitted correctly"
                )
            })
        })

        describe("transcoder is not active but is in pool", () => {
            beforeEach(async () => {
                await bondingManager.bond(2000, transcoder1, {from: transcoder1})
                await bondingManager.transcoder(5, 10, {from: transcoder1})
            })

            it("still decreases transcoder's bondedAmount", async () => {
                const startBondedAmount = (await bondingManager.getDelegator(transcoder1))[0]
                await fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [transcoder1, constants.NULL_ADDRESS, PERC_DIVISOR / 2, 0]
                    )
                )
                const endBondedAmount = (await bondingManager.getDelegator(transcoder1))[0]

                assert.equal(endBondedAmount, startBondedAmount.div(new BN(2)).toNumber(), "should decrease transcoder's bondedAmount by slashAmount")
            })

            it("decreases the total active stake for the next round", async () => {
                const startTotalActiveStake = await bondingManager.nextRoundTotalActiveStake()
                await fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [transcoder1, constants.NULL_ADDRESS, PERC_DIVISOR / 2, 0]
                    )
                )
                const endTotalActiveStake = await bondingManager.nextRoundTotalActiveStake()
                assert.equal(startTotalActiveStake.sub(endTotalActiveStake).toNumber(), 2000, "should decrease total active stake by total stake of transcoder")
            })
        })

        describe("transcoder is registered but not in pool", () => {
            beforeEach(async () => {
                await bondingManager.bond(2000, transcoder1, {from: transcoder1})
                await bondingManager.bond(100, nonTranscoder, {from: nonTranscoder})
            })
            it("still decreases transcoder's bondedAmount", async () => {
                const startBondedAmount = (await bondingManager.getDelegator(nonTranscoder))[0]
                await fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [nonTranscoder, constants.NULL_ADDRESS, PERC_DIVISOR / 2, 0]
                    )
                )
                const endBondedAmount = (await bondingManager.getDelegator(nonTranscoder))[0]

                assert.equal(endBondedAmount, startBondedAmount.div(new BN(2)).toNumber(), "should decrease transcoder's bondedAmount by slashAmount")
            })

            it("doesn't change the total for the next round", async () => {
                const startTotalActiveStake = await bondingManager.nextRoundTotalActiveStake()
                await fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [nonTranscoder, constants.NULL_ADDRESS, PERC_DIVISOR / 2, 0]
                    )
                )
                const endTotalActiveStake = await bondingManager.nextRoundTotalActiveStake()
                assert.equal(startTotalActiveStake.sub(endTotalActiveStake).toNumber(), 0, "should decrease total active stake by total stake of transcoder")
            })
        })

        describe("invoked with a finder", () => {
            it("slashes transcoder and rewards finder", async () => {
                const txRes = await fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [transcoder, finder, PERC_DIVISOR / 2, PERC_DIVISOR / 2]
                    )
                )

                truffleAssert.eventEmitted(
                    await truffleAssert.createTransactionResult(bondingManager, txRes.tx),
                    "TranscoderSlashed",
                    e => e.transcoder == transcoder &&
                        e.finder == finder &&
                        e.penalty == 500 &&
                        e.finderReward == 250,
                    "TranscoderSlashed event not emitted correctly"
                )
            })
        })

        describe("invoked without a finder", () => {
            it("slashes transcoder", async () => {
                const txRes = await fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [transcoder, constants.NULL_ADDRESS, PERC_DIVISOR / 2, 0]
                    )
                )

                truffleAssert.eventEmitted(
                    await truffleAssert.createTransactionResult(bondingManager, txRes.tx),
                    "TranscoderSlashed",
                    e => e.transcoder == transcoder &&
                        e.finder == constants.NULL_ADDRESS &&
                        e.penalty == 500 &&
                        e.finderReward == 0,
                    "TranscoderSlashed event not emitted correctly"
                )
            })
        })

        describe("transcoder no longer has a bonded amount", () => {
            beforeEach(async () => {
                await bondingManager.unbond(1000, {from: transcoder})
                const unbondingPeriod = await bondingManager.unbondingPeriod.call()
                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1 + unbondingPeriod.toNumber())
                await bondingManager.withdrawStake(0, {from: transcoder})
            })

            it("fires a TranscoderSlashed event, but transcoder is not penalized because it does not have a bonded amount", async () => {
                const txRes = await fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [transcoder, constants.NULL_ADDRESS, PERC_DIVISOR / 2, 0]
                    )
                )

                truffleAssert.eventEmitted(
                    await truffleAssert.createTransactionResult(bondingManager, txRes.tx),
                    "TranscoderSlashed",
                    e => e.transcoder == transcoder &&
                        e.finder == constants.NULL_ADDRESS &&
                        e.penalty == 0 &&
                        e.finderReward == 0,
                    "TranscoderSlashed event not emitted correctly"
                )
            })
        })
    })

    describe("claimEarnings", () => {
        const transcoder = accounts[0]
        const delegator1 = accounts[1]
        const delegator2 = accounts[2]
        const delegator3 = accounts[3]
        const currentRound = 100

        let transcoderRewards
        let transcoderFees
        let delegatorRewards
        let delegatorFees

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound - 1)

            await bondingManager.bond(1000, transcoder, {from: transcoder})
            await bondingManager.transcoder(50 * PERC_MULTIPLIER, 25 * PERC_MULTIPLIER, {from: transcoder})
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await bondingManager.bond(3000, transcoder, {from: delegator1})
            await bondingManager.bond(3000, transcoder, {from: delegator2})
            await bondingManager.bond(3000, transcoder, {from: delegator3})
            await fixture.roundsManager.execute(bondingManager.address, functionSig("setCurrentRoundTotalActiveStake()"))

            transcoderRewards = Math.floor(1000 * .5)
            transcoderFees = Math.floor(1000 * .75)
            delegatorRewards = 1000 - transcoderRewards
            delegatorFees = 1000 - transcoderFees

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
            await fixture.minter.setMockUint256(functionSig("createReward(uint256,uint256)"), 1000)
            await bondingManager.reward({from: transcoder})

            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder, 1000, currentRound + 1]
                )
            )
        })

        it("should fail if system is paused", async () => {
            await fixture.controller.pause()

            await expectRevertWithReason(bondingManager.claimEarnings(currentRound + 1, {from: delegator1}), "system is paused")
        })

        it("should fail if current round is not initialized", async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), false)

            await expectRevertWithReason(bondingManager.claimEarnings(currentRound + 1, {from: delegator1}), "current round is not initialized")
        })

        it("should fail if provided endRound is before caller's lastClaimRound", async () => {
            await expectRevertWithReason(bondingManager.claimEarnings(currentRound - 1, {from: delegator1}), "end round must be after last claim round")
        })

        it("should fail if provided endRound is in the future", async () => {
            await expectRevertWithReason(bondingManager.claimEarnings(currentRound + 2, {from: delegator1}), "end round must be before or equal to current round")
        })

        it("updates caller's lastClaimRound", async () => {
            await bondingManager.claimEarnings(currentRound + 1, {from: delegator1})

            assert.equal((await bondingManager.getDelegator(delegator1))[5], currentRound + 1, "should update caller's lastClaimRound to the current round")
        })

        it("updates transcoders cumulativeRewardFactor for _endRound EarningsPool if reward is not called for _endRound yet", async () => {
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 2)

            await bondingManager.claimEarnings(currentRound + 2, {from: delegator1})

            assert.equal(
                (await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 2)).cumulativeRewardFactor.toString(),
                (await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 1)).cumulativeRewardFactor
            )
        })

        it("fires an EarningsClaimed event", async () => {
            const expRewards = new BN(delegatorRewards * .3) // 30%
            const expFees = new BN(delegatorFees * .3) // 30%
            const acceptableDelta = 5
            const txResult = await bondingManager.claimEarnings(currentRound + 1, {from: delegator1})

            truffleAssert.eventEmitted(
                txResult,
                "EarningsClaimed",
                e => e.delegate === transcoder &&
                    e.delegator == delegator1 &&
                    e.fees - expFees <= acceptableDelta &&
                    e.rewards == expRewards.toString() &&
                    e.startRound == (currentRound + 1).toString() &&
                    e.endRound == (currentRound + 1).toString(),
                "EarningsClaimed event not emitted correctly"
            )
        })

        describe("caller has a delegate", () => {
            it("should fail if endRound - lastClaimRound > maxEarningsClaimsRounds (too many rounds to claim through)", async () => {
                await fixture.roundsManager.setMockUint256(functionSig("lipUpgradeRound(uint256)"), currentRound + 5000)
                const maxEarningsClaimsRounds = await bondingManager.maxEarningsClaimsRounds.call()
                const maxClaimRound = currentRound + 1 + maxEarningsClaimsRounds.toNumber()
                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), maxClaimRound + 1)

                await expectRevertWithReason(bondingManager.claimEarnings(maxClaimRound + 1, {from: delegator1}), "too many rounds to claim through")
            })

            it("should claim earnings for 1 round", async () => {
                const expRewards = new BN(delegatorRewards * .3) // 30%
                const expFees = new BN(delegatorFees * .3) // 30%
                const acceptableDelta = 5

                const startDInfo1 = await bondingManager.getDelegator(delegator1)
                await bondingManager.claimEarnings(currentRound + 1, {from: delegator1})
                const endDInfo1 = await bondingManager.getDelegator(delegator1)
                const d1Rewards = endDInfo1[0].sub(startDInfo1[0])
                const d1Fees = endDInfo1[1].sub(startDInfo1[1])

                const startDInfo2 = await bondingManager.getDelegator(delegator2)
                await bondingManager.claimEarnings(currentRound + 1, {from: delegator2})
                const endDInfo2 = await bondingManager.getDelegator(delegator2)
                const d2Rewards = endDInfo2[0].sub(startDInfo2[0])
                const d2Fees = endDInfo2[1].sub(startDInfo2[1])

                const startDInfo3 = await bondingManager.getDelegator(delegator3)
                await bondingManager.claimEarnings(currentRound + 1, {from: delegator3})
                const endDInfo3 = await bondingManager.getDelegator(delegator3)
                const d3Rewards = endDInfo3[0].sub(startDInfo3[0])
                const d3Fees = endDInfo3[1].sub(startDInfo3[1])

                assert.isAtMost(d1Rewards.sub(d2Rewards).abs().toNumber(), acceptableDelta)
                assert.isAtMost(d1Rewards.sub(d3Rewards).abs().toNumber(), acceptableDelta)
                assert.isAtMost(d2Rewards.sub(d3Rewards).abs().toNumber(), acceptableDelta)
                assert.isAtMost(d1Fees.sub(d2Fees).abs().toNumber(), acceptableDelta)
                assert.isAtMost(d1Fees.sub(d3Fees).abs().toNumber(), acceptableDelta)
                assert.isAtMost(d2Fees.sub(d3Fees).abs().toNumber(), acceptableDelta)
                assert.isAtMost(d1Rewards.sub(expRewards).abs().toNumber(), acceptableDelta)
                assert.isAtMost(d2Rewards.sub(expRewards).abs().toNumber(), acceptableDelta)
                assert.isAtMost(d3Rewards.sub(expRewards).abs().toNumber(), acceptableDelta)
                assert.isAtMost(d1Fees.sub(expFees).abs().toNumber(), acceptableDelta)
                assert.isAtMost(d2Fees.sub(expFees).abs().toNumber(), acceptableDelta)
                assert.isAtMost(d3Fees.sub(expFees).abs().toNumber(), acceptableDelta)
            })

            it("should claim earnings for > 1 round", async () => {
                const expRewardsFirstRound = delegatorRewards * .3 // 30%
                const expFeesFirstRound = delegatorFees * .3 // 30%
                // After first round, the expected distribution is:
                // T1 = 1000 + 500 + 50 = 1550 (~14.1%)
                // D1 = 3000 + 150 = 3150 (~28.6%)
                // D2 = 3000 + 150 = 3150 (~28.6%)
                // D2 = 3000 + 150 = 3150 (~28.6%)
                // Total = 11000
                const expRewardsSecondRound = Math.floor(delegatorRewards * .286) // 28.6%
                const expFeesSecondRound = Math.floor(delegatorFees * .286) // 28.6%
                const expRewards = new BN(expRewardsFirstRound + expRewardsSecondRound)
                const expFees = new BN(expFeesFirstRound + expFeesSecondRound)
                const acceptableDelta = 5

                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 2)
                await fixture.minter.setMockUint256(functionSig("createReward(uint256,uint256)"), 1000)
                await bondingManager.reward({from: transcoder})
                await fixture.ticketBroker.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "updateTranscoderWithFees(address,uint256,uint256)",
                        ["address", "uint256", "uint256"],
                        [transcoder, 1000, currentRound + 2]
                    )
                )

                const startDInfo1 = await bondingManager.getDelegator(delegator1)
                await bondingManager.claimEarnings(currentRound + 2, {from: delegator1})
                const endDInfo1 = await bondingManager.getDelegator(delegator1)
                const d1Rewards = endDInfo1[0].sub(startDInfo1[0])
                const d1Fees = endDInfo1[1].sub(startDInfo1[1])

                const startDInfo2 = await bondingManager.getDelegator(delegator2)
                await bondingManager.claimEarnings(currentRound + 2, {from: delegator2})
                const endDInfo2 = await bondingManager.getDelegator(delegator2)
                const d2Rewards = endDInfo2[0].sub(startDInfo2[0])
                const d2Fees = endDInfo2[1].sub(startDInfo2[1])

                const startDInfo3 = await bondingManager.getDelegator(delegator3)
                await bondingManager.claimEarnings(currentRound + 2, {from: delegator3})
                const endDInfo3 = await bondingManager.getDelegator(delegator3)
                const d3Rewards = endDInfo3[0].sub(startDInfo3[0])
                const d3Fees = endDInfo3[1].sub(startDInfo3[1])

                assert.isAtMost(d1Rewards.sub(d2Rewards).abs().toNumber(), acceptableDelta)
                assert.isAtMost(d1Rewards.sub(d3Rewards).abs().toNumber(), acceptableDelta)
                assert.isAtMost(d2Rewards.sub(d3Rewards).abs().toNumber(), acceptableDelta)
                assert.isAtMost(d1Fees.sub(d2Fees).abs().toNumber(), acceptableDelta)
                assert.isAtMost(d1Fees.sub(d3Fees).abs().toNumber(), acceptableDelta)
                assert.isAtMost(d2Fees.sub(d3Fees).abs().toNumber(), acceptableDelta)
                assert.isAtMost(d1Rewards.sub(expRewards).abs().toNumber(), acceptableDelta)
                assert.isAtMost(d2Rewards.sub(expRewards).abs().toNumber(), acceptableDelta)
                assert.isAtMost(d3Rewards.sub(expRewards).abs().toNumber(), acceptableDelta)
                assert.isAtMost(d1Fees.sub(expFees).abs().toNumber(), acceptableDelta)
                assert.isAtMost(d2Fees.sub(expFees).abs().toNumber(), acceptableDelta)
                assert.isAtMost(d3Fees.sub(expFees).abs().toNumber(), acceptableDelta)
            })

            describe("caller is a transcoder", () => {
                it("should claim earnings as both a delegator and a transcoder", async () => {
                    const expDelegatorRewards = delegatorRewards * .1 // 10%
                    const expRewards = new BN(expDelegatorRewards + transcoderRewards)
                    const expDelegatorFees = delegatorFees * .1
                    const expFees = new BN(expDelegatorFees + transcoderFees)
                    const acceptableDelta = 5

                    const startDInfo = await bondingManager.getDelegator(transcoder)
                    await bondingManager.claimEarnings(currentRound + 1, {from: transcoder})
                    const endDInfo = await bondingManager.getDelegator(transcoder)
                    const tRewards = endDInfo[0].sub(startDInfo[0])
                    const tFees = endDInfo[1].sub(startDInfo[1])

                    assert.isAtMost(tRewards.sub(expRewards).abs().toNumber(), acceptableDelta)
                    assert.isAtMost(tFees.sub(expFees).abs().toNumber(), acceptableDelta)
                })

                it("should claim earnings as both a delegator and a transcoder regardless of when other delegators claim", async () => {
                    const expDelegatorRewards = delegatorRewards * .1 // 10%
                    const expRewards = new BN(expDelegatorRewards + transcoderRewards)
                    const expDelegatorFees = delegatorFees * .1
                    const expFees = new BN(expDelegatorFees + transcoderFees)
                    const acceptableDelta = 5

                    await bondingManager.claimEarnings(currentRound + 1, {from: delegator1})
                    await bondingManager.claimEarnings(currentRound + 1, {from: delegator2})

                    const startDInfo = await bondingManager.getDelegator(transcoder)
                    await bondingManager.claimEarnings(currentRound + 1, {from: transcoder})
                    const endDInfo = await bondingManager.getDelegator(transcoder)
                    const tRewards = endDInfo[0].sub(startDInfo[0])
                    const tFees = endDInfo[1].sub(startDInfo[1])

                    assert.isAtMost(tRewards.sub(expRewards).abs().toNumber(), acceptableDelta)
                    assert.isAtMost(tFees.sub(expFees).abs().toNumber(), acceptableDelta)
                })

                it("should claim earnings and empty remaining earnings in pool as both a delegator and a transcoder", async () => {
                    await bondingManager.claimEarnings(currentRound + 1, {from: delegator1})
                    await bondingManager.claimEarnings(currentRound + 1, {from: delegator2})
                    await bondingManager.claimEarnings(currentRound + 1, {from: delegator3})
                    await bondingManager.claimEarnings(currentRound + 1, {from: transcoder})

                    const earningsPool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 1)
                    assert.equal(earningsPool[0], 0, "should set delegator reward pool for round to 0 after all delegators have claimed earnings")
                    assert.equal(earningsPool[1], 0, "should set delegator fee pool for round to 0 after all delegators have claimed earnings")
                    assert.equal(earningsPool[6], 0, "should set transcoder reward pool for round to 0")
                    assert.equal(earningsPool[7], 0, "should set transcoder fee pool for round to 0")
                    assert.equal(earningsPool[3], 0, "should set claimableStake to 0 in earningsPool for round after all delegators have claimed earnings")
                })
            })
        })
    })

    describe("claimSnapshotEarnings", () => {
        const currentRound = 100
        const delegator = accounts[0]

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound - 2)
            await bondingManager.bond(1000, delegator, {from: delegator})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await fixture.roundsManager.setMockUint256(functionSig("lipUpgradeRound(uint256)"), currentRound)
            await fixture.merkleSnapshot.setMockBool(functionSig("verify(bytes32,bytes32[],bytes32)"), true)
        })

        it("reverts if system is paused", async () => {
            await fixture.controller.pause()

            await truffleAssert.reverts(
                bondingManager.claimSnapshotEarnings(500, 1000, [], []),
                "system is paused"
            )
        })

        it("reverts if current round is not initialized", async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), false)

            await truffleAssert.reverts(
                bondingManager.claimSnapshotEarnings(1500, 1000, [], []),
                "current round is not initialized"
            )
        })

        it("reverts if the delegator has already claimed past the LIP-52 upgrade round", async () => {
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)

            // claim earnings up until and including snapshot round
            await bondingManager.claimEarnings(currentRound + 1)

            await truffleAssert.reverts(
                bondingManager.claimSnapshotEarnings(1500, 1000, [], []),
                "Already claimed for LIP-52"
            )
        })

        it("reverts if proof is invalid", async () => {
            await fixture.merkleSnapshot.setMockBool(functionSig("verify(bytes32,bytes32[],bytes32)"), false)

            await truffleAssert.reverts(
                bondingManager.claimSnapshotEarnings(1500, 1000, [], []),
                "Merkle proof is invalid"
            )
        })

        it("sets delegators lastClaimRound to the LIP-52 upgrade round", async () => {
            await bondingManager.claimSnapshotEarnings(1500, 1000, [], [])

            assert.equal((await bondingManager.getDelegator(delegator)).lastClaimRound.toNumber(), currentRound)
        })

        it("updates a delegator's stake and fees", async () => {
            await bondingManager.claimSnapshotEarnings(1500, 1000, [], [])

            const del = await bondingManager.getDelegator(delegator)
            assert.equal(del.bondedAmount.toNumber(), 1500)
            assert.equal(del.fees.toNumber(), 1000)
        })

        it("emits an EarningsClaimed event", async () => {
            const lastClaimRound = (await bondingManager.getDelegator(delegator)).lastClaimRound
            truffleAssert.eventEmitted(
                await bondingManager.claimSnapshotEarnings(1500, 1000, [], []),
                "EarningsClaimed",
                e => e.delegate == delegator
                && e.delegator == delegator
                && e.rewards == 500
                && e.fees == 1000
                && e.startRound == lastClaimRound.add(new BN(1)).toNumber()
                && e.endRound == currentRound

            )
        })

        it("executes an unbonding operation as additional call through the 'data' argument", async () => {
            const data = bondingManager.contract.methods.unbond(500).encodeABI()
            await bondingManager.claimSnapshotEarnings(1500, 1000, [], data)
            const del = await bondingManager.getDelegator(delegator)
            assert.equal(del.bondedAmount.toNumber(), 1000)
        })

        it("executes a bond operation as additional call through the 'data' argument", async () => {
            const data = bondingManager.contract.methods.bond(500, delegator).encodeABI()
            await bondingManager.claimSnapshotEarnings(1500, 1000, [], data)
            const del = await bondingManager.getDelegator(delegator)
            assert.equal(del.bondedAmount.toNumber(), 2000)
        })

        it("reverts when executing a claimEarnings operation that is not past the lastClaimRound as additional call through the 'data' argument", async () => {
            const data = bondingManager.contract.methods.claimEarnings(currentRound - 1).encodeABI()
            await truffleAssert.reverts(
                bondingManager.claimSnapshotEarnings(1500, 1000, [], data),
                "end round must be after last claim round"
            )
        })
    })

    describe("pendingStake", () => {
        const transcoder = accounts[0]
        const delegator = accounts[1]
        const currentRound = 100

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound - 2)

            await bondingManager.bond(1000, transcoder, {from: transcoder})
            await bondingManager.transcoder(50 * PERC_MULTIPLIER, 25 * PERC_MULTIPLIER, {from: transcoder})
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound - 1)
            await bondingManager.bond(1000, transcoder, {from: delegator})
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)

            await fixture.minter.setMockUint256(functionSig("createReward(uint256,uint256)"), 1000)
            await bondingManager.reward({from: transcoder})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)

            await bondingManager.reward({from: transcoder})
        })

        it("should return pending rewards for 1 round", async () => {
            const pendingRewards0 = 250

            assert.equal(
                (await bondingManager.pendingStake(delegator, currentRound)).toString(),
                (1000 + pendingRewards0).toString(),
                "should return sum of bondedAmount and pending rewards for 1 round"
            )
        })

        it("should return pending rewards for > 1 round", async () => {
            const pendingRewards0 = 250
            const pendingRewards1 = Math.floor((500 * (1250 * PERC_DIVISOR / 3000)) / PERC_DIVISOR)

            assert.equal(
                (await bondingManager.pendingStake(delegator, currentRound + 1)).toString(),
                1000 + pendingRewards0 + pendingRewards1,
                "should return sum of bondedAmount and pending rewards for 2 rounds"
            )
        })

        it("should return pending rewards for > 1 round when endRound > currentRound", async () => {
            const pendingRewards0 = 250
            const pendingRewards1 = Math.floor((500 * (1250 * PERC_DIVISOR / 3000)) / PERC_DIVISOR)

            assert.equal(
                (await bondingManager.pendingStake(delegator, currentRound + 2)).toString(),
                (1000 + pendingRewards0 + pendingRewards1).toString()
            )
        })

        it("should return delegator.bondedAmount when endRound < lastClaimRound", async () => {
            await bondingManager.claimEarnings(currentRound + 1, {from: delegator})

            const bondedAmount = (await bondingManager.getDelegator(delegator)).bondedAmount
            assert.equal(
                (await bondingManager.pendingStake(delegator, currentRound)).toString(),
                bondedAmount.toString()
            )
        })

        it("should return delegator.bondedAmount when endRound = lastClaimRound", async () => {
            await bondingManager.claimEarnings(currentRound + 1, {from: delegator})

            const bondedAmount = (await bondingManager.getDelegator(delegator)).bondedAmount
            assert.equal(
                (await bondingManager.pendingStake(delegator, currentRound + 1)).toString(),
                bondedAmount.toString()
            )
        })

        it("should return pending rewards through lastRewardRound if transcoder hasn't called reward for the end round", async () => {
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 2)

            const pendingRewards0 = 250
            const pendingRewards1 = Math.floor((500 * (1250 * PERC_DIVISOR / 3000)) / PERC_DIVISOR)

            assert.equal(
                (await bondingManager.pendingStake(delegator, currentRound + 2)).toString(),
                (1000 + pendingRewards0 + pendingRewards1).toString()
            )
        })

        it("should return pending rewards even if transcoder hasn't called reward for it's lastClaimRound", async () => {
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 2)

            await bondingManager.claimEarnings(currentRound + 2, {from: delegator})

            const pendingRewards0 = 250
            const pendingRewards1 = Math.floor((500 * (1250 * PERC_DIVISOR / 3000)) / PERC_DIVISOR)
            const pendingRewards2 = Math.floor((500 * ((1000 + pendingRewards0 + pendingRewards1) * PERC_DIVISOR / 4000 ) ) / PERC_DIVISOR)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 3)

            await bondingManager.reward({from: transcoder})

            assert.equal((await bondingManager.pendingStake(delegator, currentRound + 3)).toNumber(), 1000 + pendingRewards0 + pendingRewards1 + pendingRewards2)
        })

        describe("no rewards since last claim round", async () => {
            const bondedAmount = 1000 + 250 + Math.floor((500 * (1250 * PERC_DIVISOR / 3000)) / PERC_DIVISOR)

            beforeEach(async () => {
                await bondingManager.claimEarnings(currentRound + 1, {from: delegator})

                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 2)
            })

            it("should return bondedAmount when transcoder.lastRewardRound < delegator.lastClaimRound", async () => {
                // Claim rewards through currentRound + 2
                await bondingManager.claimEarnings(currentRound + 2, {from: delegator})

                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 3)
                // The transcoder's pool has claimableStake = 0 for currentRound + 3 because the transcoder did not call reward()
                // in currentRound + 2 so it did not update the claimableStake in its pool for currentRound + 3
                assert.equal((await bondingManager.pendingStake(delegator, currentRound + 3)).toNumber(), bondedAmount)
            })
        })

        describe("delegator is a transcoder", () => {
            it("should return pending rewards as both a delegator and a transcoder", async () => {
                let cumulativeRewards = (await bondingManager.getTranscoder(transcoder)).cumulativeRewards.toNumber()
                const pendingRewards = 250 + cumulativeRewards

                assert.equal(
                    (await bondingManager.pendingStake(transcoder, currentRound)).toNumber(),
                    1000 + pendingRewards,
                    "should return sum of bondedAmount and pending rewards as both a delegator and transcoder for a round"
                )
            })
        })
    })

    describe("pendingFees", () => {
        const transcoder = accounts[0]
        const delegator = accounts[1]
        const currentRound = 100

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound - 1)

            await bondingManager.bond(1000, transcoder, {from: transcoder})
            await bondingManager.transcoder(50 * PERC_MULTIPLIER, 25 * PERC_MULTIPLIER, {from: transcoder})
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await bondingManager.bond(1000, transcoder, {from: delegator})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder, 1000, currentRound + 1]
                )
            )
            await fixture.minter.setMockUint256(functionSig("createReward(uint256,uint256)"), 1000)
            await bondingManager.reward({from: transcoder})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 2)
            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder, 1000, currentRound + 2]
                )
            )

            await bondingManager.reward({from: transcoder})
        })

        it("should return pending fees for 1 round", async () => {
            const pendingFees0 = 125

            assert.equal((await bondingManager.pendingFees(delegator, currentRound + 1)).toString(), pendingFees0, "should return sum of collected fees and pending fees for 1 round")
        })

        it("should return pending fees for > 1 round", async () => {
            const pendingFees0 = 125
            const pendingFees1 = Math.floor((250 * (1250 * PERC_DIVISOR / 3000)) / PERC_DIVISOR)

            assert.equal(
                (await bondingManager.pendingFees(delegator, currentRound + 2)).toNumber(),
                pendingFees0 + pendingFees1,
                "should return sum of collected fees and pending fees for 2 rounds"
            )
        })

        it("should return pending fees for > 1 round when endRound > currentRound", async () => {
            const pendingFees0 = 125
            const pendingFees1 = Math.floor((250 * (1250 * PERC_DIVISOR / 3000)) / PERC_DIVISOR)

            assert.equal(
                (await bondingManager.pendingFees(delegator, currentRound + 3)).toString(),
                (pendingFees0 + pendingFees1).toString()
            )
        })

        it("should return delegator.fees when endRound < lastClaimRound", async () => {
            await bondingManager.claimEarnings(currentRound + 2, {from: delegator})

            const fees = (await bondingManager.getDelegator(delegator)).fees
            assert.equal(
                (await bondingManager.pendingFees(delegator, currentRound + 1)).toString(),
                fees.toString()
            )
        })

        it("should return delegator.fees when endRound = lastClaimRound", async () => {
            await bondingManager.claimEarnings(currentRound + 2, {from: delegator})

            const fees = (await bondingManager.getDelegator(delegator)).fees
            assert.equal(
                (await bondingManager.pendingFees(delegator, currentRound + 2)).toString(),
                fees.toString()
            )
        })

        it("should return pending fees when transcoder has claimed earnings since LIP36", async () => {
            const pendingFees0 = 125
            const pendingFees1 = Math.floor((250 * (1250 * PERC_DIVISOR / 3000)) / PERC_DIVISOR)
            const pendingFees2 = Math.floor((250 * (1458 * PERC_DIVISOR / 4000)) / PERC_DIVISOR)

            await bondingManager.claimEarnings(currentRound + 2, {from: delegator})
            const fees = (await bondingManager.getDelegator(delegator)).fees
            assert.equal(pendingFees0 + pendingFees1, fees.toNumber(), "delegator fees not correct")

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 3)

            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder, 1000, currentRound + 3]
                )
            )

            assert.equal(
                (await bondingManager.pendingFees(delegator, currentRound + 3)).toString(),
                (fees.toNumber() + pendingFees2).toString()
            )

            await bondingManager.withdrawFees({from: delegator})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 4)

            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder, 1000, currentRound + 4]
                )
            )
            assert.equal((await bondingManager.pendingFees(delegator, currentRound + 4)).toString(), pendingFees2.toString())
        })

        it("should return pending fees when transcoder hasn't called reward since the previous round", async () => {
            const pendingFees0 = 125
            const pendingFees1 = Math.floor((250 * (1250 * PERC_DIVISOR / 3000)) / PERC_DIVISOR)
            const pendingFees2 = Math.floor((250 * (1458 * PERC_DIVISOR / 4000)) / PERC_DIVISOR)

            await bondingManager.claimEarnings(currentRound + 2, {from: delegator})
            const fees = (await bondingManager.getDelegator(delegator)).fees
            assert.equal(pendingFees0 + pendingFees1, fees.toNumber(), "delegator fees not correct")

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 3)

            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder, 1000, currentRound + 3]
                )
            )

            assert.equal(
                (await bondingManager.pendingFees(delegator, currentRound + 3)).toString(),
                (fees.toNumber() + pendingFees2).toString()
            )

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 4)

            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder, 1000, currentRound + 4]
                )
            )
            assert.equal(
                (await bondingManager.pendingFees(delegator, currentRound + 4)).toString(),
                (pendingFees0 + pendingFees1 + pendingFees2 * 2).toString()
            )
        })

        it("should return pending fees when transcoder hasn't called reward for the previous round but has for the current round", async () => {
            const pendingFees0 = 125
            const pendingFees1 = Math.floor((250 * (1250 * PERC_DIVISOR / 3000)) / PERC_DIVISOR)
            const pendingFees2 = Math.floor((250 * (1458 * PERC_DIVISOR / 4000)) / PERC_DIVISOR)
            const pendingFees3 = Math.floor((250 * (1640 * PERC_DIVISOR / 5000)) / PERC_DIVISOR)

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 3)

            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder, 1000, currentRound + 3]
                )
            )

            assert.equal(
                (await bondingManager.pendingFees(delegator, currentRound + 3)).toString(),
                (pendingFees0 + pendingFees1 + pendingFees2).toString()
            )

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 4)
            await fixture.minter.setMockUint256(functionSig("currentMintableTokens()"), 0)
            await fixture.minter.setMockUint256(functionSig("currentMintedTokens()"), 1000)
            await fixture.roundsManager.execute(bondingManager.address, functionSig("setCurrentRoundTotalActiveStake()"))

            await bondingManager.reward({from: transcoder})

            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder, 1000, currentRound + 4]
                )
            )

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 5)
            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder, 1000, currentRound + 4]
                )
            )

            assert.equal(
                (await bondingManager.pendingFees(delegator, currentRound + 5)).toString(),
                (pendingFees0 + pendingFees1 + pendingFees2 * 2 + pendingFees3).toString()
            )
        })

        describe("no fees since lastClaimRound", async () => {
            const fees = 125 + Math.floor((250 * (1250 * PERC_DIVISOR / 3000)) / PERC_DIVISOR)

            beforeEach(async () => {
                await bondingManager.claimEarnings(currentRound + 2, {from: delegator})

                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 3)
            })

            it("should return current fees when there are no additional fees since last claim round", async () => {
                // Claim fees through currentRound + 3
                // At this point, the delegator's fees should not have changed because the delegator received 0 fees
                // for currentRound + 3
                await bondingManager.claimEarnings(currentRound + 3, {from: delegator})

                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 4)

                assert.equal((await bondingManager.pendingFees(delegator, currentRound + 4)).toNumber(), fees)
            })
        })

        describe("delegator is a transcoder", () => {
            it("should return pending fees as both a delegator and a transcoder", async () => {
                let cumulativeFees = (await bondingManager.getTranscoder(transcoder)).cumulativeFees.toNumber()

                const pendingFees = 125 + cumulativeFees

                assert.equal(
                    (await bondingManager.pendingFees(transcoder, currentRound + 1)).toNumber(),
                    pendingFees,
                    "should return sum of collected fees and pending fees as both a delegator and transcoder for a round"
                )
            })
        })
    })

    describe("setCurrentRoundTotalActiveStake", () => {
        const transcoder = accounts[0]

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)

            await bondingManager.bond(1000, transcoder, {from: transcoder})
            await bondingManager.transcoder(5, 10, {from: transcoder})
        })

        it("fails if caller is not RoundsManager", async () => {
            await expectRevertWithReason(bondingManager.setCurrentRoundTotalActiveStake(), "caller must be RoundsManager")
        })

        it("sets currentRoundTotalActiveStake equal to nextRoundTotalActiveStake", async () => {
            await fixture.roundsManager.execute(bondingManager.address, functionSig("setCurrentRoundTotalActiveStake()"))
            assert.equal(await bondingManager.currentRoundTotalActiveStake(), 1000)
        })
    })

    describe("transcoderStatus", () => {
        const transcoder = accounts[0]

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await bondingManager.bond(1000, transcoder, {from: transcoder})
        })

        describe("caller is not bonded to self", () => {
            it("returns NotRegistered", async () => {
                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), 1)
                await bondingManager.unbond(1000, {from: transcoder})

                assert.equal(await bondingManager.transcoderStatus(transcoder), TranscoderStatus.NotRegistered, "should return NotRegistered")
            })
        })

        describe("caller is bonded to self", () => {
            it("returns Registered", async () => {
                assert.equal(await bondingManager.transcoderStatus(transcoder), TranscoderStatus.Registered, "should return Registered")
            })
        })
    })

    describe("isActiveTranscoder", () => {
        const transcoder = accounts[0]
        const currentRound = 100

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound - 1)

            await bondingManager.bond(1000, transcoder, {from: transcoder})
            await bondingManager.transcoder(5, 10, {from: transcoder})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await fixture.roundsManager.execute(bondingManager.address, functionSig("setCurrentRoundTotalActiveStake()"))
        })

        describe("caller is not in transcoder pool", () => {
            it("returns false", async () => {
                await bondingManager.unbond(1000, {from: transcoder})
                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
                assert.isFalse(await bondingManager.isActiveTranscoder(transcoder), "should return NotRegistered for caller not in transcoder pool")
            })
        })

        describe("caller is in transcoder pool", () => {
            it("returns true", async () => {
                assert.isTrue(await bondingManager.isActiveTranscoder(transcoder), "should return Registered for caller in transcoder pool")
            })
        })
    })

    describe("delegatorStatus", () => {
        const delegator0 = accounts[0]
        const transcoder = accounts[1]
        const currentRound = 100

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
        })

        describe("caller has zero bonded amount", () => {
            it("returns Unbonded", async () => {
                assert.equal(await bondingManager.delegatorStatus(delegator0), DelegatorStatus.Unbonded, "should return Unbonded for delegator with zero bonded amount")
            })
        })

        describe("caller has a startRound", () => {
            beforeEach(async () => {
                await bondingManager.bond(1000, transcoder, {from: delegator0})
            })

            describe("startRound is now", () => {
                it("returns Bonded", async () => {
                    const startRound = (await bondingManager.getDelegator(delegator0))[4]
                    await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), startRound)

                    assert.equal(await bondingManager.delegatorStatus(delegator0), DelegatorStatus.Bonded, "should return Bonded for delegator with startRound now")
                })
            })

            describe("startRound is in the past", () => {
                it("returns Bonded", async () => {
                    const startRound = (await bondingManager.getDelegator(delegator0))[4]
                    await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), startRound.toNumber() + 1)

                    assert.equal(await bondingManager.delegatorStatus(delegator0), DelegatorStatus.Bonded, "should return Bodned for delegator with startRound in past")
                })
            })

            describe("startRound is in the future", () => {
                it("returns Pending", async () => {
                    assert.equal(await bondingManager.delegatorStatus(delegator0), DelegatorStatus.Pending, "should return Pending for delegator with startRound in future")
                })
            })
        })
    })

    describe("isRegisteredTranscoder", () => {
        const transcoder = accounts[0]
        const currentRound = 100

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound - 1)

            await bondingManager.bond(1000, transcoder, {from: transcoder})
            await bondingManager.transcoder(5, 10, {from: transcoder})
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
        })

        describe("address is registered transcoder", () => {
            it("should return true", async () => {
                assert.isOk(await bondingManager.isRegisteredTranscoder(transcoder), "should return true for registered transcoder")
            })
        })

        describe("address is not registered transcoder", () => {
            it("should return false", async () => {
                assert.isNotOk(await bondingManager.isRegisteredTranscoder(accounts[2]), "should return false for address that is not registered transcoder")
            })
        })
    })

    describe("isValidUnbondingLock", () => {
        const delegator = accounts[0]
        const unbondingLockID = 0
        const currentRound = 100

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)

            await bondingManager.bond(1000, delegator, {from: delegator})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
        })

        describe("unbonding lock's withdrawRound > 0", () => {
            it("should return true", async () => {
                await bondingManager.unbond(500, {from: delegator})

                assert.isOk(await bondingManager.isValidUnbondingLock(delegator, unbondingLockID), "should return true for lock with withdrawRound > 0")
            })
        })

        describe("unbonding lock's withdrawRound = 0", () => {
            it("should return false", async () => {
                assert.isNotOk(await bondingManager.isValidUnbondingLock(delegator, unbondingLockID), "should return false for lock with withdrawRound = 0")
            })
        })
    })

    describe("getTotalBonded", () => {
        const transcoder0 = accounts[0]
        const transcoder1 = accounts[1]
        const delegator0 = accounts[2]
        const delegator1 = accounts[3]

        const currentRound = 100

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
            await bondingManager.bond(1000, transcoder0, {from: transcoder0})
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
            await fixture.roundsManager.execute(bondingManager.address, functionSig("setCurrentRoundTotalActiveStake()"))
        })

        it("returns the total active stake for the current round", async () => {
            // Check that getTotalBonded() reflects active stake of transcoder0
            assert.equal(await bondingManager.getTotalBonded(), 1000)
        })

        it("returns the same value when called multiple times in the same round", async () => {
            await bondingManager.bond(2000, transcoder1, {from: transcoder1})

            // Check that getTotalBonded() does not reflect active stake of transcoder1 because
            // the next round has not been initialized
            assert.equal(await bondingManager.getTotalBonded(), 1000)

            await bondingManager.bond(500, transcoder0, {from: delegator0})

            // Check that getTotalBonded() does not reflect new stake delegated to transcoder0 because
            // the next round has not been initialized
            assert.equal(await bondingManager.getTotalBonded(), 1000)
        })

        it("returns updated total active stake for a round after it is initialized", async () => {
            await bondingManager.bond(2000, transcoder1, {from: transcoder1})
            await bondingManager.bond(500, transcoder0, {from: delegator0})
            await bondingManager.bond(700, transcoder1, {from: delegator1})
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 2)
            await fixture.roundsManager.execute(bondingManager.address, functionSig("setCurrentRoundTotalActiveStake()"))

            // Check that getTotalBonded() includes active stake of transcoder1 (includes new stake delegated from delegator1)
            // and new stake delegated to transcoder0 by delegator0
            assert.equal(await bondingManager.getTotalBonded(), 4200)
        })
    })
})
