import Fixture from "./helpers/Fixture"
import expectThrow from "../helpers/expectThrow"
import expectRevertWithReason from "../helpers/expectFail"
import {contractId, functionSig, functionEncodedABI} from "../../utils/helpers"
import {constants} from "../../utils/constants"
import BN from "bn.js"
import truffleAssert from "truffle-assertions"

const BondingManager = artifacts.require("BondingManager")

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
            await expectThrow(bondingManager.setController(accounts[0]))
        })

        it("should set new Controller", async () => {
            await fixture.controller.updateController(contractId("BondingManager"), accounts[0])

            assert.equal(await bondingManager.controller.call(), accounts[0], "should set new Controller")
        })
    })

    describe("setUnbondingPeriod", () => {
        it("should fail if caller is not Controller owner", async () => {
            await expectThrow(bondingManager.setUnbondingPeriod(5, {from: accounts[2]}))
        })

        it("should set unbondingPeriod", async () => {
            await bondingManager.setUnbondingPeriod(5)

            assert.equal(await bondingManager.unbondingPeriod.call(), 5, "wrong unbondingPeriod")
        })
    })

    describe("setNumActiveTranscoders", () => {
        it("should fail if caller is not Controller owner", async () => {
            await expectThrow(bondingManager.setNumActiveTranscoders(7, {from: accounts[2]}))
        })

        it("should set numActiveTranscoders", async () => {
            await bondingManager.setNumActiveTranscoders(4)

            assert.equal(await bondingManager.getTranscoderPoolMaxSize(), 4, "wrong numActiveTranscoders")
        })
    })

    describe("setMaxEarningsClaimsRounds", () => {
        it("should fail if caller is not Controller owner", async () => {
            await expectThrow(bondingManager.setMaxEarningsClaimsRounds(2, {from: accounts[2]}))
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

            await expectThrow(bondingManager.transcoder(5, 10))
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
                    bondingManager.TranscoderUpdate({transcoder: accounts[0]}).on("data", e => {
                        assert.equal(e.returnValues.pendingRewardCut, 5, "should fire TranscoderUpdate event with provided rewardCut")
                        assert.equal(e.returnValues.pendingFeeShare, 10, "should fire TranscoderUpdate event with provided feeShare")
                        assert.equal(e.returnValues.args.registered, true, "should fire TranscoderUpdate event with registered set to true")
                    })

                    await bondingManager.bond(1000, accounts[0])
                    await bondingManager.transcoder(5, 10)

                    assert.equal(await bondingManager.getTotalBonded(), 1000, "wrong total bonded")
                    assert.equal(await bondingManager.getTranscoderPoolSize(), 1, "wrong transcoder pool size")
                    assert.equal(await bondingManager.getFirstTranscoderInPool(), accounts[0], "wrong first transcoder in pool")
                    assert.equal(await bondingManager.transcoderTotalStake(accounts[0]), 1000, "wrong transcoder total stake")
                })

                it("should add multiple additional transcoders to the pool", async () => {
                    await bondingManager.bond(2000, accounts[0])
                    await bondingManager.transcoder(5, 10)
                    await bondingManager.bond(1000, accounts[1], {from: accounts[1]})
                    await bondingManager.transcoder(5, 10, {from: accounts[1]})

                    assert.equal(await bondingManager.getTotalBonded(), 3000, "wrong total bonded")
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

                        bondingManager.TranscoderUpdate({transcoder: newTranscoder}).on("data", e => {
                            assert.equal(e.returnValues.pendingRewardCut, 5, "should fire TranscoderUpdate event with provided rewardCut")
                            assert.equal(e.returnValues.pendingFeeShare, 10, "should fire TranscoderUpdate event with provided feeShare")
                            assert.equal(e.returnValues.registered, true, "should fire TranscoderUpdate event with registered set to true")
                        })

                        const totalBonded = (await bondingManager.getTotalBonded()).toNumber()

                        // Caller bonds 6000 which is more than transcoder with least delegated stake
                        await bondingManager.bond(6000, newTranscoder, {from: newTranscoder})
                        await bondingManager.transcoder(5, 10, {from: newTranscoder})
                        await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound+1)

                        // Subtract evicted transcoder's delegated stake and add new transcoder's delegated stake
                        const expTotalBonded = totalBonded - 1000 + 6000
                        assert.equal(await bondingManager.getTotalBonded(), expTotalBonded, "wrong total bonded")

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

                        bondingManager.TranscoderUpdate({transcoder: newTranscoder}).on("data", e => {
                            assert.equal(e.returnValues.pendingRewardCut, 5, "should fire TranscoderUpdate event with provided rewardCut")
                            assert.equal(e.returnValues.pendingFeeShare, 10, "should fire TranscoderUpdate event with provided feeShare")
                            assert.equal(e.returnValues.registered, false, "should fire TranscoderUpdate event with registered set to true")
                        })

                        // Caller bonds 600 - less than transcoder with least delegated stake
                        await bondingManager.bond(600, newTranscoder, {from: newTranscoder})
                        await bondingManager.transcoder(5, 10, {from: newTranscoder})
                        await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound+1)

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

                        bondingManager.TranscoderUpdate({transcoder: newTranscoder}).on("data", e => {
                            assert.equal(e.returnValues.pendingRewardCut, 5, "should fire TranscoderUpdate event with provided rewardCut")
                            assert.equal(e.returnValues.pendingFeeShare, 10, "should fire TranscoderUpdate event with provided feeShare")
                            assert.equal(e.returnValues.registered, false, "should fire TranscoderUpdate event with registered set to true")
                        })

                        // Caller bonds 2000 - same as transcoder with least delegated stake
                        await bondingManager.bond(2000, newTranscoder, {from: newTranscoder})
                        await bondingManager.transcoder(5, 10, {from: newTranscoder})
                        await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound+1)
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
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound-1)

            await bondingManager.bond(1000, transcoder0, {from: transcoder0})
            await bondingManager.transcoder(5, 10, {from: transcoder0})
            await bondingManager.bond(2000, transcoder1, {from: transcoder1})
            await bondingManager.transcoder(5, 10, {from: transcoder1})
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)
        })

        it("should fail if current round is not initialized", async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), false)

            await expectThrow(bondingManager.bond(1000, transcoder0, {from: delegator}))
        })

        describe("update transcoder pool", () => {
            beforeEach(async () => {
                await bondingManager.bond(500, transcoder2, {from: transcoder2})
                await bondingManager.transcoder(5, 10, {from: transcoder2})
                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound+1)
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

            describe("evicts a transcoder from the pool", () => {
                it("last transcoder gets evicted and new transcoder gets inserted", async () => {
                    const txRes = await bondingManager.bond(2000, transcoder2, {from: delegator})
                    truffleAssert.eventEmitted(txRes, "TranscoderEvicted", e => {
                        return e.transcoder == transcoder0
                    })
                    await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 2)
                    assert.isTrue(await bondingManager.isActiveTranscoder(transcoder2))
                    assert.isTrue(await bondingManager.isActiveTranscoder(transcoder1))
                    assert.isFalse(await bondingManager.isActiveTranscoder(transcoder0))
                    assert.equal((await bondingManager.transcoderTotalStake(transcoder2)).toString(), "2500")
                })

                it("sets deactivationRound for the inserted transcoder to the max possible round number", async () => {
                    await bondingManager.bond(2000, transcoder2, {from: delegator})
                    assert.equal((await bondingManager.getTranscoder(transcoder2)).deactivationRound, 2**256-1)
                })

                it("sets the deactivationRound for the evicted transcoder to the next round", async () => {
                    await bondingManager.bond(2000, transcoder2, {from: delegator})
                    assert.equal((await bondingManager.getTranscoder(transcoder0)).deactivationRound, currentRound + 2)
                })
            })

            it("inserts into pool without evicting if pool is not full", async () => {
                await bondingManager.unbond(2000, {from: transcoder1})
                await bondingManager.bond(2500, transcoder2, {from: delegator})
                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound+2)
                assert.isTrue(await bondingManager.isActiveTranscoder(transcoder2))
                assert.isTrue(await bondingManager.isActiveTranscoder(transcoder0))
                // transcoder 2 should be first
                assert.equal(await bondingManager.getFirstTranscoderInPool(), transcoder2)
            })

            it("doesn't insert into pool when stake is too low", async () => {
                await bondingManager.bond(10, transcoder2, {from: delegator})
                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound+2)
                assert.isFalse(await bondingManager.isActiveTranscoder(transcoder2))
            })

            it("updates total stake in earnings pool for next round", async () => {
                // evict transcoder0 from the pool
                await bondingManager.bond(2000, transcoder2, {from: delegator})
                const poolT2 = await bondingManager.getTranscoderEarningsPoolForRound(transcoder2, currentRound+2)
                assert.equal(poolT2.totalStake, 2500)
            })
        })

        describe("caller is unbonded", () => {
            it("should fail if provided amount = 0", async () => {
                await expectThrow(bondingManager.bond(0, transcoder0, {from: delegator}))
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
                bondingManager.Bond({}).on("data", e => {
                    assert.equal(e.returnValues.newDelegate, transcoder0, "wrong newDelegate in Bond event")
                    assert.equal(e.returnValues.oldDelegate, constants.NULL_ADDRESS, "wrong oldDelegate in Bond event")
                    assert.equal(e.returnValues.delegator, delegator, "wrong delegator in Bond event")
                    assert.equal(e.returnValues.additionalAmount, 1000, "wrong additionalAmount in Bond event")
                    assert.equal(e.returnValues.bondedAmount, 1000, "wrong bondedAmount in Bond event")
                })

                await bondingManager.bond(1000, transcoder0, {from: delegator})
            })

            describe("delegate is a registered transcoder", () => {
                it("should increase transcoder's delegated stake in pool", async () => {
                    const startTotalBonded = await bondingManager.getTotalBonded()
                    const startTranscoderTotalStake = await bondingManager.transcoderTotalStake(transcoder0)
                    await bondingManager.bond(1000, transcoder0, {from: delegator})
                    const endTotalBonded = await bondingManager.getTotalBonded()
                    const endTranscoderTotalStake = await bondingManager.transcoderTotalStake(transcoder0)

                    assert.equal(endTotalBonded.sub(startTotalBonded), 1000, "wrong change in total bonded")
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
                    assert.equal((await bondingManager.getTranscoder(transcoder0)).lastActiveStakeUpdateRound, currentRound+1)
                })
            })

            describe("delegate is not a registered transcoder", () => {
                it("should not update total bonded", async () => {
                    const startTotalBonded = await bondingManager.getTotalBonded()
                    await bondingManager.bond(1000, nonTranscoder, {from: delegator})
                    const endTotalBonded = await bondingManager.getTotalBonded()

                    assert.equal(endTotalBonded.sub(startTotalBonded), 0, "wrong change in total bonded")
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
                            assert.equal((await bondingManager.getTranscoder(transcoder0)).lastActiveStakeUpdateRound, currentRound+1)
                            assert.equal((await bondingManager.getTranscoder(transcoder1)).lastActiveStakeUpdateRound, currentRound+1)
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
                            assert.equal((await bondingManager.getTranscoder(transcoder0)).lastActiveStakeUpdateRound, currentRound +1)
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
                            assert.equal((await bondingManager.getTranscoder(transcoder0)).lastActiveStakeUpdateRound, currentRound+1)
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
                        bondingManager.Bond({}).on("data", e => {
                            assert.equal(e.returnValues.newDelegate, transcoder1, "wrong newDelegate in Bond event")
                            assert.equal(e.returnValues.oldDelegate, transcoder0, "wrong oldDelegate in Bond event")
                            assert.equal(e.returnValues.delegator, delegator, "wrong delegator in Bond event")
                            assert.equal(e.returnValues.additionalAmount, 0, "wrong additionalAmount in Bond event")
                            assert.equal(e.returnValues.bondedAmount, 2000, "wrong bondedAmount in Bond event")
                        })

                        await bondingManager.bond(0, transcoder1, {from: delegator})
                    })

                    describe("new delegate is registered transcoder", () => {
                        it("should increase transcoder's total stake in pool with current bonded stake", async () => {
                            const startTranscoderTotalStake = await bondingManager.transcoderTotalStake(transcoder1)
                            await bondingManager.bond(0, transcoder1, {from: delegator})
                            const endTranscoderTotalStake = await bondingManager.transcoderTotalStake(transcoder1)

                            assert.equal(endTranscoderTotalStake.sub(startTranscoderTotalStake), 2000, "wrong change in transcoder total stake")
                        })

                        describe("old delegate is registered transcoder", () => {
                            it("should not change total bonded", async () => {
                                const startTotalBonded = await bondingManager.getTotalBonded()
                                await bondingManager.bond(0, transcoder1, {from: delegator})
                                const endTotalBonded = await bondingManager.getTotalBonded()

                                assert.equal(endTotalBonded.sub(startTotalBonded), 0, "wrong change in total bonded")
                            })
                        })

                        describe("old delegate is not registered transcoder", () => {
                            it("should increase total bonded", async () => {
                                // Delegate to non-transcoder
                                await bondingManager.bond(0, nonTranscoder, {from: delegator})

                                const startTotalBonded = await bondingManager.getTotalBonded()
                                await bondingManager.bond(0, transcoder1, {from: delegator})
                                const endTotalBonded = await bondingManager.getTotalBonded()

                                assert.equal(endTotalBonded.sub(startTotalBonded), 2000, "wrong change in total bonded")
                            })
                        })
                    })

                    describe("new delegate is not registered transcoder", () => {
                        describe("old delegate is registered transcoder", () => {
                            it("should decrease total bonded", async () => {
                                const startTotalBonded = await bondingManager.getTotalBonded()
                                await bondingManager.bond(0, nonTranscoder, {from: delegator})
                                const endTotalBonded = await bondingManager.getTotalBonded()

                                assert.equal(startTotalBonded.sub(endTotalBonded), 2000, "wrong change in total bonded")
                            })
                        })

                        describe("old delegate is not registered transcoder", () => {
                            it("should not change total bonded", async () => {
                                // Delegate to non-transcoder
                                await bondingManager.bond(0, nonTranscoder, {from: delegator})

                                const startTotalBonded = await bondingManager.getTotalBonded()
                                await bondingManager.bond(0, delegator2, {from: delegator})
                                const endTotalBonded = await bondingManager.getTotalBonded()

                                assert.equal(endTotalBonded.sub(startTotalBonded), 0, "wrong change in total bonded")
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

                    it("should update total bonded tokens", async () => {
                        const startTotalBonded = await bondingManager.getTotalBonded()
                        await bondingManager.bond(1000, transcoder1, {from: delegator})
                        const endTotalBonded = await bondingManager.getTotalBonded()

                        assert.equal(endTotalBonded.sub(startTotalBonded), 1000, "wrong change in totalBonded")
                    })

                    it("should increase the total stake for the next round", async () => {
                        const startTotalStake = await bondingManager.nextRoundTotalActiveStake()
                        await bondingManager.bond(1000, transcoder1, {from: delegator})
                        const endTotalStake = await bondingManager.nextRoundTotalActiveStake()
                        assert.equal(endTotalStake.sub(startTotalStake), 1000, "wrong change in total next round stake")
                    })

                    it("should fire a Bond event when increasing bonded stake and changing delegates", async () => {
                        bondingManager.Bond({}).on("data", e => {
                            assert.equal(e.returnValues.newDelegate, transcoder1, "wrong newDelegate in Bond event")
                            assert.equal(e.returnValues.oldDelegate, transcoder0, "wrong oldDelegate in Bond event")
                            assert.equal(e.returnValues.delegator, delegator, "wrong delegator in Bond event")
                            assert.equal(e.returnValues.additionalAmount, 1000, "wrong additionalAmount in Bond event")
                            assert.equal(e.returnValues.bondedAmount, 3000, "wrong bondedAmount in Bond event")
                        })

                        await bondingManager.bond(1000, transcoder1, {from: delegator})
                    })

                    describe("new delegate is registered transcoder", () => {
                        it("should increase transcoder's total stake in pool with current bonded stake + provided amount", async () => {
                            const startTranscoderTotalStake = await bondingManager.transcoderTotalStake(transcoder1)
                            await bondingManager.bond(1000, transcoder1, {from: delegator})
                            const endTranscoderTotalStake = await bondingManager.transcoderTotalStake(transcoder1)

                            assert.equal(endTranscoderTotalStake.sub(startTranscoderTotalStake), 3000, "wrong change in transcoder total stake")
                        })

                        describe("old delegate is registered transcoder", () => {
                            it("should only increase total bonded by additional bonded stake", async () => {
                                const startTotalBonded = await bondingManager.getTotalBonded()
                                await bondingManager.bond(1000, transcoder1, {from: delegator})
                                const endTotalBonded = await bondingManager.getTotalBonded()

                                assert.equal(endTotalBonded.sub(startTotalBonded), 1000, "wrong change in totalBonded")
                            })
                        })

                        describe("old delegate is not registered transcoder", () => {
                            it("should increase total bonded by current bonded stake + additional bonded stake", async () => {
                                // Delegate to non-transcoder
                                await bondingManager.bond(0, nonTranscoder, {from: delegator})

                                const bondedAmount = (await bondingManager.getDelegator(delegator))[0].toNumber()
                                const startTotalBonded = await bondingManager.getTotalBonded()
                                await bondingManager.bond(1000, transcoder1, {from: delegator})
                                const endTotalBonded = await bondingManager.getTotalBonded()

                                assert.equal(endTotalBonded.sub(startTotalBonded), bondedAmount + 1000, "wrong change in totalBonded")
                            })
                        })
                    })

                    describe("new delegate is not registered transcoder", () => {
                        describe("old delegate is registered transcoder", () => {
                            it("should decrease total bonded by current bonded stake (no additional bonded stake counted)", async () => {
                                const bondedAmount = (await bondingManager.getDelegator(delegator))[0].toNumber()
                                const startTotalBonded = await bondingManager.getTotalBonded()
                                await bondingManager.bond(1000, nonTranscoder, {from: delegator})
                                const endTotalBonded = await bondingManager.getTotalBonded()

                                assert.equal(startTotalBonded.sub(endTotalBonded), bondedAmount, "wrong change in totalBonded")
                            })

                            it("should decrease the total stake for the next round", async () => {
                                const startTotalStake = await bondingManager.nextRoundTotalActiveStake()
                                await bondingManager.bond(1000, nonTranscoder, {from: delegator})
                                const endTotalStake = await bondingManager.nextRoundTotalActiveStake()
                                assert.equal(startTotalStake.sub(endTotalStake).toString(), 2000, "wrong change in total next round stake")
                            })
                        })

                        describe("old delegate is not registered transcoder", () => {
                            beforeEach(async () => {
                                // Delegate to non-transcoder
                                await bondingManager.bond(0, nonTranscoder, {from: delegator})
                            })
                            it("should not change total bonded", async () => {
                                const startTotalBonded = await bondingManager.getTotalBonded()
                                await bondingManager.bond(1000, delegator2, {from: delegator})
                                const endTotalBonded = await bondingManager.getTotalBonded()

                                assert.equal(endTotalBonded.sub(startTotalBonded), 0, "wrong change in totalBonded")
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
                    await expectThrow(bondingManager.bond(0, transcoder0, {from: delegator}))
                })

                it("should update bonded amount", async () => {
                    const startBondedAmount = (await bondingManager.getDelegator(delegator))[0]
                    await bondingManager.bond(1000, transcoder0, {from: delegator})
                    const endBondedAmount = (await bondingManager.getDelegator(delegator))[0]

                    assert.equal(endBondedAmount.sub(startBondedAmount), 1000, "wrong change in bondedAmount")
                })

                describe("delegate is registered transcoder", () => {
                    it("should increase total bonded", async () => {
                        const startTotalBonded = await bondingManager.getTotalBonded()
                        await bondingManager.bond(1000, transcoder0, {from: delegator})
                        const endTotalBonded = await bondingManager.getTotalBonded()

                        assert.equal(endTotalBonded.sub(startTotalBonded), 1000, "wrong change in totalBonded")
                    })

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
                    it("should not change total bonded", async () => {
                        const startTotalBonded = await bondingManager.getTotalBonded()
                        await bondingManager.bond(1000, nonTranscoder, {from: delegator})
                        const endTotalBonded = await bondingManager.getTotalBonded()

                        assert.equal(endTotalBonded.sub(startTotalBonded), 0, "wrong change in totalBonded")
                    })

                    it("should not change the total active stake for next round", async () => {
                        const startTotalActiveStake = await bondingManager.nextRoundTotalActiveStake()
                        await bondingManager.bond(1000, nonTranscoder, {from: delegator})
                        const endTotalActiveStake = await bondingManager.nextRoundTotalActiveStake()
                        assert.equal(endTotalActiveStake.sub(startTotalActiveStake), 0, "wrong change in nextRoundTotalActiveStake")
                    })
                })

                it("should fire a Bond event when increasing bonded amount", async () => {
                    bondingManager.Bond({}).on("data", e => {
                        assert.equal(e.returnValues.newDelegate, transcoder0, "wrong newDelegate in Bond event")
                        assert.equal(e.returnValues.oldDelegate, transcoder0, "wrong oldDelegate in Bond event")
                        assert.equal(e.returnValues.delegator, delegator, "wrong delegator in Bond event")
                        assert.equal(e.returnValues.additionalAmount, 1000, "wrong additionalAmount in Bond event")
                        assert.equal(e.returnValues.bondedAmount, 3000, "wrong bondedAmount in Bond event")
                    })

                    await bondingManager.bond(1000, transcoder0, {from: delegator})
                })
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

            await expectThrow(bondingManager.unbond(500, {from: delegator}))
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
                bondingManager.Unbond({}).on("data", e => {
                    assert.equal(e.returnValues.delegate, transcoder, "wrong delegate in Unbond event")
                    assert.equal(e.returnValues.delegator, delegator, "wrong delegator in Unbond event")
                    assert.equal(e.returnValues.unbondingLockId, unbondingLockID.toNumber(), "wrong unbondingLockId in Unbond event")
                    assert.equal(e.returnValues.amount, 500, "wrong amount in Unbond event")
                    assert.equal(e.returnValues.withdrawRound, currentRound + 1 + unbondingPeriod, "wrong withdrawRound in Unbond event")
                })

                await bondingManager.unbond(500, {from: delegator})
            })

            describe("delegated to non-transcoder", () => {
                it("should not change total bonded", async () => {
                    const startTotalBonded = await bondingManager.getTotalBonded()
                    // Caller is delegator delegated to non-transcoder
                    await bondingManager.unbond(500, {from: delegator2})
                    const endTotalBonded = await bondingManager.getTotalBonded()
                    assert.equal(endTotalBonded.sub(startTotalBonded), 0, "wrong change in total bonded")
                })

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

                it("should decrease total bonded", async () => {
                    const startTotalBonded = await bondingManager.getTotalBonded()
                    await bondingManager.unbond(500, {from: delegator})
                    const endTotalBonded = await bondingManager.getTotalBonded()

                    assert.equal(startTotalBonded.sub(endTotalBonded), 500, "wrong change in total bonded")
                })

                it("should decrease the total stake for the next round", async () => {
                    const startTotalStake = await bondingManager.nextRoundTotalActiveStake()
                    await bondingManager.unbond(500, {from: delegator})
                    const endTotalStake = await bondingManager.nextRoundTotalActiveStake()
                    assert.equal(startTotalStake.sub(endTotalStake), 500, "wrong change in total next round stake")
                })

                it("should update delegate's lastActiveStakeUpdateRound", async () => {
                    await bondingManager.unbond(500, {from: delegator})
                    assert.equal((await bondingManager.getTranscoder(transcoder)).lastActiveStakeUpdateRound, currentRound+2)
                })
            })

            describe("delegated to self with non-zero bonded amount and is registered transcoder", () => {
                it("should decrease delegated transcoder's (self) delegated stake in pool", async () => {
                    // Caller is transcoder delegated to self
                    await bondingManager.unbond(500, {from: transcoder})

                    assert.equal(await bondingManager.transcoderTotalStake(transcoder), 1500, "wrong transcoder total stake")
                })

                it("should decrease total bonded", async () => {
                    const startTotalBonded = await bondingManager.getTotalBonded()
                    await bondingManager.unbond(500, {from: transcoder})
                    const endTotalBonded = await bondingManager.getTotalBonded()

                    assert.equal(startTotalBonded.sub(endTotalBonded), 500, "wrong change in total bonded")
                })

                it("should decrease the total stake for the next round", async () => {
                    const startTotalStake = await bondingManager.nextRoundTotalActiveStake()
                    await bondingManager.unbond(500, {from: transcoder})
                    const endTotalStake = await bondingManager.nextRoundTotalActiveStake()
                    assert.equal(startTotalStake.sub(endTotalStake), 500, "wrong change in total next round stake")
                })

                it("should update delegate's lastActiveStakeUpdateRound", async () => {
                    await bondingManager.unbond(500, {from: delegator})
                    assert.equal((await bondingManager.getTranscoder(transcoder)).lastActiveStakeUpdateRound, currentRound+2)
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
                bondingManager.Unbond({}).on("data", e => {
                    assert.equal(e.returnValues.delegate, transcoder, "wrong delegate in Unbond event")
                    assert.equal(e.returnValues.delegator, delegator, "wrong delegator in Unbond event")
                    assert.equal(e.returnValues.unbondingLockId, unbondingLockID.toNumber(), "wrong unbondingLockId in Unbond event")
                    assert.equal(e.returnValues.amount, 1000, "wrong amount in Unbond event")
                    assert.equal(e.returnValues.withdrawRound, currentRound + 1 + unbondingPeriod, "wrong withdrawRound in Unbond event")
                })

                await bondingManager.unbond(1000, {from: delegator})
            })

            describe("is a registered transcoder", () => {
                it("should resign as a transcoder", async () => {
                    // Caller is transcoder delegated to self
                    await bondingManager.unbond(1000, {from: transcoder})

                    assert.isFalse(await bondingManager.isRegisteredTranscoder(transcoder), "wrong transcoder status")
                })

                it("should decrease total bonded by entire delegated stake (not just own bonded stake)", async () => {
                    const startTotalBonded = await bondingManager.getTotalBonded()
                    await bondingManager.unbond(1000, {from: transcoder})
                    const endTotalBonded = await bondingManager.getTotalBonded()
                    // Decrease by 2000 (delegated stake) instead of just 1000 (own bonded stake)
                    assert.equal(startTotalBonded.sub(endTotalBonded).toString(), 2000, "wrong change in total bonded")
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
            })

            describe("is not a registered transcoder", () => {
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

            await expectThrow(bondingManager.rebond(unbondingLockID, {from: delegator}))
        })

        it("should fail if delegator is not in the Bonded or Pending state", async () => {
            // Unbond the rest of the delegator's tokens so it is no longer has any bonded tokens
            await bondingManager.unbond(500, {from: delegator})

            await expectRevertWithReason(bondingManager.rebond(unbondingLockID, {from: delegator}), "caller must be bonded")
        })

        it("should fail for invalid unbonding lock ID", async () => {
            // Unbonding lock for ID does not exist
            await expectThrow(bondingManager.rebond(unbondingLockID + 5, {from: delegator}))
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

            it("should increase total bonded", async () => {
                const startTotalBonded = await bondingManager.getTotalBonded()
                await bondingManager.rebond(unbondingLockID, {from: delegator})
                const endTotalBonded = await bondingManager.getTotalBonded()

                assert.equal(endTotalBonded.sub(startTotalBonded), 500, {from: delegator})
            })

            it("should increase total active stake for the next round", async () => {
                const startTotalActiveStake = await bondingManager.nextRoundTotalActiveStake()
                await bondingManager.rebond(unbondingLockID, {from: delegator})
                const endTotalActiveStake = await bondingManager.nextRoundTotalActiveStake()
                assert.equal(endTotalActiveStake.sub(startTotalActiveStake), 500, "wrong change in nextRoundTotalActiveStake")
            })

            it("should update delegate's lastActiveStakeUpdateRound", async () => {
                await bondingManager.rebond(unbondingLockID, {from: delegator})
                assert.equal((await bondingManager.getTranscoder(transcoder)).lastActiveStakeUpdateRound, currentRound+2)
            })

            it("should evict when rebonding and pool is full", async () => {
                await bondingManager.bond(1900, transcoder1, {from: transcoder1})
                await bondingManager.transcoder(5, 10, {from: transcoder1})
                await bondingManager.bond(1800, transcoder2, {from: transcoder2})
                await bondingManager.transcoder(5, 10, {from: transcoder2})
                bondingManager.TranscoderEvicted({}).on("data", e => {
                    assert.equal(e.returnValues.transcoder, transcoder2)
                })
                await bondingManager.rebond(unbondingLockID, {from: delegator})
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
            it("should not change total bonded", async () => {
                const startTotalBonded = await bondingManager.getTotalBonded()
                await bondingManager.rebond(unbondingLockID, {from: delegator})
                const endTotalBonded = await bondingManager.getTotalBonded()

                assert.equal(endTotalBonded.sub(startTotalBonded), 0, {from: delegator})
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
            bondingManager.Rebond({}).on("data", e => {
                assert.equal(e.returnValues.delegate, transcoder, "wrong delegate in Rebond event")
                assert.equal(e.returnValues.delegator, delegator, "wrong delegator in Rebond event")
                assert.equal(e.returnValues.unbondingLockId, unbondingLockID, "wrong unbondingLockId in Rebond event")
                assert.equal(e.returnValues.amount, 500, "wrong amount in Rebond event")
            })

            await bondingManager.rebond(unbondingLockID, {from: delegator})
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

            await expectThrow(bondingManager.rebondFromUnbonded(transcoder, unbondingLockID, {from: delegator}))
        })

        it("should fail if delegator is not in Unbonded state", async () => {
            await expectThrow(bondingManager.rebondFromUnbonded(transcoder, unbondingLockID, {from: delegator}))
        })

        it("should fail for invalid unbonding lock ID", async () => {
            // Delegator unbonds rest of tokens transitioning to the Unbonded state
            await bondingManager.unbond(500, {from: delegator})

            // Unbonding lock for ID does not exist
            await expectThrow(bondingManager.rebond(unbondingLockID + 5, {from: delegator}))
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

            it("should increase total bonded", async () => {
                const startTotalBonded = await bondingManager.getTotalBonded()
                await bondingManager.rebondFromUnbonded(transcoder, unbondingLockID, {from: delegator})
                const endTotalBonded = await bondingManager.getTotalBonded()
                assert.equal(endTotalBonded.sub(startTotalBonded), 500, "wrong total bonded")
            })

            it("should increase the total active stake for the next round", async () => {
                const startTotalActiveStake = await bondingManager.nextRoundTotalActiveStake()
                await bondingManager.rebondFromUnbonded(transcoder, unbondingLockID, {from: delegator})
                const endTotalActiveStake = await bondingManager.nextRoundTotalActiveStake()
                assert.equal(endTotalActiveStake.sub(startTotalActiveStake), 500, "wrong change in nextRoundTotalActiveStake")
            })

            it("should update delegate's lastActiveStakeUpdateRound", async () => {
                await bondingManager.rebondFromUnbonded(transcoder, unbondingLockID, {from: delegator})
                assert.equal((await bondingManager.getTranscoder(transcoder)).lastActiveStakeUpdateRound, currentRound+2)
            })
        })

        describe("new delegate is not a registered transcoder", () => {
            beforeEach(async () => {
                // Delegator unbonds rest of tokens transitioning to the Unbonded state
                // 500 is unbonded from transcoder in the active pool
                await bondingManager.unbond(500, {from: delegator})
            })
            it("should not change total bonded", async () => {
                const startTotalBonded = await bondingManager.getTotalBonded()
                // nonTranscoder is not in the active pool so totalBonded should not change
                await bondingManager.rebondFromUnbonded(nonTranscoder, unbondingLockID, {from: delegator})
                const endTotalBonded = await bondingManager.getTotalBonded()
                assert.equal(endTotalBonded.sub(startTotalBonded), 0, "wrong total bonded")
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

            bondingManager.Rebond({}).on("data", e => {
                assert.equal(e.returnValues.delegate, transcoder, "wrong delegate in Rebond event")
                assert.equal(e.returnValues.delegator, delegator, "wrong delegator in Rebond event")
                assert.equal(e.returnValues.unbondingLockId, unbondingLockID, "wrong unbondingLockId in Rebond event")
                assert.equal(e.returnValues.amount, 500, "wrong amount in Rebond event")
            })

            await bondingManager.rebondFromUnbonded(transcoder, unbondingLockID, {from: delegator})
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

            await expectThrow(bondingManager.withdrawStake(unbondingLockID, {from: delegator}))
        })

        it("should fail if unbonding lock is invalid", async () => {
            // Unbonding lock for ID does not exist
            await expectThrow(bondingManager.withdrawStake(unbondingLockID + 5, {from: delegator}))
        })

        it("should fail if unbonding lock withdraw round is in the future", async () => {
            await expectThrow(bondingManager.withdrawStake(unbondingLockID, {from: delegator}))
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
            bondingManager.WithdrawStake({}).on("data", e => {
                assert.equal(e.returnValues.delegator, delegator, "wrong delegator in WithdrawStake event")
                assert.equal(e.returnValues.unbondingLockId, unbondingLockID, "wrong unbondingLockId in WithdrawStake event")
                assert.equal(e.returnValues.amount, 500, "wrong amount in WithdrawStake event")
                assert.equal(e.returnValues.withdrawRound, currentRound + 1 + unbondingPeriod, "wrong withdrawRound in WithdrawStake event")
            })

            await bondingManager.withdrawStake(unbondingLockID, {from: delegator})
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

            await expectThrow(bondingManager.withdrawFees({from: transcoder0}))
        })

        it("should fail if there are no fees to withdraw", async () => {
            await expectThrow(bondingManager.withdrawFees({from: transcoder1}))
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
            await bondingManager.transcoder(5, 10, {from: transcoder})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
            await fixture.minter.setMockUint256(functionSig("createReward(uint256,uint256)"), 1000)
        })

        it("should fail if system is paused", async () => {
            await fixture.controller.pause()

            await expectRevertWithReason(bondingManager.reward({from: transcoder}), "system is paused")
        })

        it("should fail if current round is not initialized", async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), false)

            await expectThrow(bondingManager.reward({from: transcoder}))
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
            const startTotalBonded = await bondingManager.getTotalBonded()
            await bondingManager.reward({from: transcoder})
            const endDelegatedAmount = (await bondingManager.getDelegator(transcoder))[3]
            const endTotalStake = await bondingManager.transcoderTotalStake(transcoder)
            const endTotalBonded = await bondingManager.getTotalBonded()

            const earningsPool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 1)
            assert.equal(earningsPool[0], 1000, "should update rewards in earnings pool for current round")

            assert.equal(endDelegatedAmount.sub(startDelegatedAmount), 1000, "should update delegatedAmount with new rewards")
            assert.equal(endTotalStake.sub(startTotalStake), 1000, "should update transcoder's total stake in the pool with new rewards")
            assert.equal(endTotalBonded.sub(startTotalBonded), 1000, "should update total bonded with new rewards")
        })

        it("should update caller with rewards if lastActiveStakeUpdateRound < currentRound", async () => {
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 3)
            const startDelegatedAmount = (await bondingManager.getDelegator(transcoder))[3]
            const startTotalStake = await bondingManager.transcoderTotalStake(transcoder)
            const startTotalBonded = await bondingManager.getTotalBonded()
            await bondingManager.reward({from: transcoder})
            const endDelegatedAmount = (await bondingManager.getDelegator(transcoder))[3]
            const endTotalStake = await bondingManager.transcoderTotalStake(transcoder)
            const endTotalBonded = await bondingManager.getTotalBonded()

            const earningsPool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 3)
            assert.equal(earningsPool[0], 1000, "should update rewards in earnings pool for current round")

            assert.equal(endDelegatedAmount.sub(startDelegatedAmount), 1000, "should update delegatedAmount with new rewards")
            assert.equal(endTotalStake.sub(startTotalStake), 1000, "should update transcoder's total stake in the pool with new rewards")
            assert.equal(endTotalBonded.sub(startTotalBonded), 1000, "should update total bonded with new rewards")
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
            await bondingManager.transcoder(0, 0, {from: transcoder})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
        })

        it("should fail if system is paused", async () => {
            await fixture.controller.pause()

            await expectThrow(
                fixture.ticketBroker.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "updateTranscoderWithFees(address,uint256,uint256)",
                        ["address", "uint256", "uint256"],
                        [transcoder, 1000, currentRound + 1]
                    )
                )
            )
        })

        it("should fail if caller is not TicketBroker", async () => {
            await expectThrow(bondingManager.updateTranscoderWithFees(transcoder, 1000, currentRound + 1))
        })

        it("should fail if transcoder is not registered", async () => {
            await expectThrow(
                fixture.ticketBroker.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "updateTranscoderWithFees(address,uint256,uint256)",
                        ["address", "uint256", "uint256"],
                        [nonTranscoder, 1000, currentRound + 1]
                    )
                )
            )
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

            const earningsPool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 1)
            assert.equal(earningsPool.transcoderFeePool, 1000, "should update fees in earnings pool for current round")
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

            await expectThrow(
                fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [transcoder, constants.NULL_ADDRESS, PERC_DIVISOR / 2, PERC_DIVISOR / 2]
                    )
                )
            )
        })

        it("should fail if caller is not TicketBroker", async () => {
            await expectThrow(bondingManager.slashTranscoder(transcoder, constants.NULL_ADDRESS, PERC_DIVISOR / 2, PERC_DIVISOR / 2))
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
            it("updates delegated amount and total bonded tokens", async () => {
                const startTotalBonded = await bondingManager.getTotalBonded()
                await fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [transcoder, constants.NULL_ADDRESS, PERC_DIVISOR / 2, 0]
                    )
                )
                const endTotalBonded = await bondingManager.getTotalBonded()

                assert.equal((await bondingManager.getDelegator(transcoder))[3], 500, "should decrease delegatedAmount for transcoder by slash amount")
                assert.equal(startTotalBonded.sub(endTotalBonded), 1000, "should decrease total bonded tokens by transcoder's delegated stake")
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
                bondingManager.TranscoderSlashed({transcoder: transcoder}).on("data", e => {
                    assert.equal(e.returnValues.finder, finder, "should fire TranscoderSlashed event with finder")
                    assert.equal(e.returnValues.penalty, 500, "should fire TranscoderSlashed event with slashed amount penalty")
                    assert.equal(e.returnValues.finderReward, 250, "should fire TranscoderSlashed event with finder reward computed with finderFee")
                })

                await fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [transcoder, finder, PERC_DIVISOR / 2, PERC_DIVISOR / 2]
                    )
                )
            })
        })

        describe("invoked without a finder", () => {
            it("slashes transcoder", async () => {
                bondingManager.TranscoderSlashed({transcoder: transcoder}).on("data", e => {
                    assert.equal(e.returnValues.finder, constants.NULL_ADDRESS, "should fire TranscoderSlashed event with null finder")
                    assert.equal(e.returnValues.penalty, 500, "should fire TranscoderSlashed event with slashed amount penalty")
                    assert.equal(e.returnValues.finderReward, 0, "should fire TranscoderSlashed event with finder reward of 0")
                })

                await fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [transcoder, constants.NULL_ADDRESS, PERC_DIVISOR / 2, 0]
                    )
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
                bondingManager.TranscoderSlashed({transcoder: transcoder}).on("data", e => {
                    assert.equal(e.returnValues.finder, constants.NULL_ADDRESS, "should fire TranscoderSlashed event with null finder")
                    assert.equal(e.returnValues.penalty, 0, "should fire TranscoderSlashed event with slashed amount penalty of 0")
                    assert.equal(e.returnValues.finderReward, 0, "should fire TranscoderSlashed event with finder reward of 0")
                })

                await fixture.verifier.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [transcoder, constants.NULL_ADDRESS, PERC_DIVISOR / 2, 0]
                    )
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

            await expectThrow(bondingManager.claimEarnings(currentRound + 1, {from: delegator1}))
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

        it("fires an EarningsClaimed event", async () => {
            const expRewards = new BN(delegatorRewards * .3) // 30%
            const expFees = new BN(delegatorFees * .3) // 30%
            const txResult = await bondingManager.claimEarnings(currentRound + 1, {from: delegator1})

            truffleAssert.eventEmitted(txResult, "EarningsClaimed", e => {
                return e.delegate === transcoder &&
                           e.delegator == delegator1 &&
                           e.fees == expFees.toString() &&
                           e.rewards == expRewards.toString() &&
                           e.startRound == (currentRound + 1).toString() &&
                           e.endRound == (currentRound + 1).toString()
            })
        })

        describe("caller has a delegate", () => {
            it("should fail if endRound - lastClaimRound > maxEarningsClaimsRounds (too many rounds to claim through)", async () => {
                const maxEarningsClaimsRounds = await bondingManager.maxEarningsClaimsRounds.call()
                const maxClaimRound = currentRound + 1 + maxEarningsClaimsRounds.toNumber()
                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), maxClaimRound + 1)

                await expectRevertWithReason(bondingManager.claimEarnings(maxClaimRound+ 1, {from: delegator1}), "too many rounds to claim through")
            })

            it("should claim earnings for 1 round", async () => {
                const expRewards = new BN(delegatorRewards * .3) // 30%
                const expFees = new BN(delegatorFees * .3) // 30%
                const acceptableDelta = 2

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

                const claimedRewards = d1Rewards.add(d2Rewards).add(d3Rewards)
                const claimedFees = d1Fees.add(d2Fees).add(d3Fees)

                const earningsPool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 1)
                assert.equal(earningsPool[0], delegatorRewards - claimedRewards.toNumber())
                assert.equal(earningsPool[1], delegatorFees - claimedFees.toNumber())
                assert.equal(earningsPool[3], 1000)
                assert.equal(earningsPool[6], transcoderRewards)
                assert.equal(earningsPool[7], transcoderFees)
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
                const acceptableDelta = 2

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

                const earningsPoolFirstRound = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 1)
                const earningsPoolSecondRound = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 2)
                const expRemainingRewardsFirstRound = delegatorRewards - (3 * expRewardsFirstRound)
                const expRemainingFeesFirstRound = delegatorFees - (3 * expFeesFirstRound)
                const expRemainingRewardsSecondRound = delegatorRewards - (3 * expRewardsSecondRound)
                const expRemainingFeesSecondRound = delegatorFees - (3 * expFeesSecondRound)

                assert.isAtMost(earningsPoolFirstRound[0].sub(new BN(expRemainingRewardsFirstRound)).abs().toNumber(), acceptableDelta, "should decrease delegator reward pool by delegator's claimed rewards for round")
                assert.isAtMost(earningsPoolFirstRound[1].sub(new BN(expRemainingFeesFirstRound)).abs().toNumber(), acceptableDelta, "should decrease delegator fee pool by delegator's claimed fees for round")
                assert.equal(earningsPoolFirstRound[6], transcoderRewards, "should not affect transcoder reward pool")
                assert.equal(earningsPoolFirstRound[7], transcoderFees, "should not affect transcoder fee pool")
                assert.equal(earningsPoolFirstRound[3], 1000, "should decrease claimableStake for earningsPool by delegator's stake for round")
                assert.isAtMost(earningsPoolSecondRound[0].sub(new BN(expRemainingRewardsSecondRound)).abs().toNumber(), acceptableDelta, "should decrease delegator reward pool by delegator's claimed rewards for round")
                assert.isAtMost(earningsPoolSecondRound[1].sub(new BN(expRemainingFeesSecondRound)).abs().toNumber(), acceptableDelta, "should decrease delegator fee pool by delegator's claimed fees for round")
                assert.equal(earningsPoolSecondRound[6], transcoderRewards, "should not affect transcoder reward pool")
                assert.equal(earningsPoolSecondRound[7], transcoderFees, "should not affect transcoder fee pool")
                assert.isAtMost(earningsPoolSecondRound[3].sub(new BN(1550)).toNumber(), acceptableDelta, "should decrease claimableStake for earningsPool by delegator's stake for round")
            })

            describe("caller is a transcoder", () => {
                it("should claim earnings as both a delegator and a transcoder", async () => {
                    const expDelegatorRewards = delegatorRewards * .1 // 10%
                    const expRewards = new BN(expDelegatorRewards + transcoderRewards)
                    const expDelegatorFees = delegatorFees * .1
                    const expFees = new BN(expDelegatorFees + transcoderFees)
                    const acceptableDelta = 2

                    const startDInfo = await bondingManager.getDelegator(transcoder)
                    await bondingManager.claimEarnings(currentRound + 1, {from: transcoder})
                    const endDInfo = await bondingManager.getDelegator(transcoder)
                    const tRewards = endDInfo[0].sub(startDInfo[0])
                    const tFees = endDInfo[1].sub(startDInfo[1])

                    assert.isAtMost(tRewards.sub(expRewards).abs().toNumber(), acceptableDelta)
                    assert.isAtMost(tFees.sub(expFees).abs().toNumber(), acceptableDelta)

                    const earningsPool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 1)
                    assert.equal(earningsPool[0], delegatorRewards - tRewards.sub(new BN(transcoderRewards)).toNumber(), "should decrease delegator reward pool by transcoder's claimed rewards for round")
                    assert.equal(earningsPool[1], delegatorFees - tFees.sub(new BN(transcoderFees)).toNumber(), "should decrease delegator fee pool by transcoder's claimed fees for round")
                    assert.equal(earningsPool[6], 0, "should set transcoder reward pool to 0")
                    assert.equal(earningsPool[7], 0, "should set transcoder fee pool to 0")
                    assert.equal(earningsPool[3], 9000, "should decrease claimableStake for earningsPool by transcoder's stake for round")
                })

                it("should claim earnings as both a delegator and a transcoder regardless of when other delegators claim", async () => {
                    const expDelegatorRewards = delegatorRewards * .1 // 10%
                    const expRewards = new BN(expDelegatorRewards + transcoderRewards)
                    const expDelegatorFees = delegatorFees * .1
                    const expFees = new BN(expDelegatorFees + transcoderFees)
                    const acceptableDelta = 2

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

            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder, 1000, currentRound]
                )
            )
            await fixture.minter.setMockUint256(functionSig("createReward(uint256,uint256)"), 1000)
            await bondingManager.reward({from: transcoder})

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
        })

        it("should fail if endRound is after current round", async () => {
            await expectThrow(bondingManager.pendingStake(delegator, currentRound + 3))
        })

        it("should fail if endRound is before lastClaimRound", async () => {
            await expectThrow(bondingManager.pendingStake(delegator, currentRound - 2))
        })

        it("should fail if endRound = lastClaimRound", async () => {
            await expectThrow(bondingManager.pendingStake(delegator, currentRound - 1))
        })

        it("should return pending rewards for 1 round", async () => {
            const pendingRewards0 = 250
            assert.equal(
                await bondingManager.pendingStake(delegator, currentRound),
                1000 + pendingRewards0,
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

        describe("no claimable shares for the round", async () => {
            const bondedAmount = 1000 + 250 + Math.floor((500 * (1250 * PERC_DIVISOR / 3000)) / PERC_DIVISOR)

            beforeEach(async () => {
                await bondingManager.claimEarnings(currentRound + 1, {from: delegator})

                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 2)
            })

            it("should return bondedAmount + 0 (pending rewards) when pool.claimableStake > 0", async () => {
                // The transcoder's pool has claimableStake > 0 for currentRound + 2 because the transcoder called reward()
                // in currentRound + 1 which updates the claimableStake in the transcoder's pool for currentRound + 2
                assert.equal(await bondingManager.pendingStake(delegator, currentRound + 2), bondedAmount, "should return sum of bondedAmount + 0 (pending rewards) for 1 round")
            })

            it("should return bondedAmount + 0 (pending rewards) when pool.claimableStake = 0", async () => {
                // Claim rewards through currentRound + 2
                // At this point, the delegator's bondedAmount should not have changed because the delegator received 0 rewards
                // for currentRound + 1
                await bondingManager.claimEarnings(currentRound + 2, {from: delegator})

                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 3)

                // The transcoder's pool has claimableStake = 0 for currentRound + 3 because the transcoder did not call reward()
                // in currentRound + 2 so it did not update the claimableStake in its pool for currentRound + 3
                assert.equal(await bondingManager.pendingStake(delegator, currentRound + 3), bondedAmount)
            })
        })

        describe("delegator is a transcoder", () => {
            it("should return pending rewards as both a delegator and a transcoder", async () => {
                const pendingRewards = 500 + 250

                assert.equal(
                    await bondingManager.pendingStake(transcoder, currentRound),
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
            await fixture.minter.setMockUint256(functionSig("createReward(uint256,uint256)"), 1000)
            await bondingManager.reward({from: transcoder})
        })

        it("should fail if endRound is after current round", async () => {
            await expectThrow(bondingManager.pendingFees(delegator, currentRound + 3))
        })

        it("should fail if endRound is before lastClaimRound", async () => {
            await expectThrow(bondingManager.pendingFees(delegator, currentRound - 1))
        })

        it("should fail if endRound = lastClaimRound", async () => {
            await expectThrow(bondingManager.pendingFees(delegator, currentRound))
        })

        it("should return pending fees for 1 round", async () => {
            const pendingFees0 = 125
            assert.equal((await bondingManager.pendingFees(delegator, currentRound + 1)).toString(), pendingFees0, "should return sum of collected fees and pending fees for 1 round")
        })

        it("should return pending fees for > 1 round", async () => {
            const pendingFees0 = 125
            const pendingFees1 = Math.floor((250 * (1250 * PERC_DIVISOR / 3000)) / PERC_DIVISOR)

            assert.equal(
                await bondingManager.pendingFees(delegator, currentRound + 2),
                pendingFees0 + pendingFees1,
                "should return sum of collected fees and pending fees for 2 rounds"
            )
        })

        describe("no claimable shares for the round", async () => {
            beforeEach(async () => {
                await bondingManager.claimEarnings(currentRound + 2, {from: delegator})

                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 3)
            })

            it("should return fees + 0 (pending fees)", async () => {
                const fees = 125 + Math.floor((250 * (1250 * PERC_DIVISOR / 3000)) / PERC_DIVISOR)

                assert.equal(await bondingManager.pendingFees(delegator, currentRound + 3), fees, "should return sum of collected fees + 0 (pending fees) for 1 round")
            })
        })

        describe("delegator is a transcoder", () => {
            it("should return pending fees as both a delegator and a transcoder", async () => {
                const pendingFees = 750 + 125

                assert.equal(
                    await bondingManager.pendingFees(transcoder, currentRound + 1),
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
                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound+1)
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
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound-1)

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
})
