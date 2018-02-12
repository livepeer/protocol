import Fixture from "./helpers/Fixture"
import expectThrow from "../helpers/expectThrow"
import {functionSig, functionEncodedABI} from "../../utils/helpers"
import {constants} from "../../utils/constants"

const BondingManager = artifacts.require("BondingManager")

contract("BondingManager", accounts => {
    let fixture
    let bondingManager

    const NUM_TRANSCODERS = 5
    const NUM_ACTIVE_TRANSCODERS = 2
    const UNBONDING_PERIOD = 2
    const MAX_EARNINGS_CLAIMS_ROUNDS = 20

    const PERC_DIVISOR = 1000000
    const PERC_MULTIPLIER = PERC_DIVISOR / 100

    const DelegatorStatus = {
        Pending: 0,
        Bonded: 1,
        Unbonding: 2,
        Unbonded: 3
    }

    const TranscoderStatus = {
        NotRegistered: 0,
        Registered: 1
    }

    before(async () => {
        fixture = new Fixture(web3)
        await fixture.deploy()

        bondingManager = await fixture.deployAndRegister(BondingManager, "BondingManager", fixture.controller.address)

        await bondingManager.setUnbondingPeriod(UNBONDING_PERIOD)
        await bondingManager.setNumTranscoders(NUM_TRANSCODERS)
        await bondingManager.setNumActiveTranscoders(NUM_ACTIVE_TRANSCODERS)
        await bondingManager.setMaxEarningsClaimsRounds(MAX_EARNINGS_CLAIMS_ROUNDS)
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
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

    describe("setNumTranscoders", () => {
        it("should fail if caller is not Controller owner", async () => {
            await expectThrow(bondingManager.setNumTranscoders(15, {from: accounts[2]}))
        })

        it("should fail if provided numTranscoders < current numActiveTranscoders", async () => {
            await expectThrow(bondingManager.setNumTranscoders(1))
        })

        it("should fail if provided numTranscoders < current numTranscoders", async () => {
            // This is a limitation of the sorted doubly linked list implementation used
            // to track the transcoder pool
            await expectThrow(bondingManager.setNumTranscoders(4))
        })

        it("should set the max size of the transcoder pool", async () => {
            await bondingManager.setNumTranscoders(15)

            assert.equal(await bondingManager.getTranscoderPoolMaxSize(), 15, "wrong transcoder pool max size")
        })
    })

    describe("setNumActiveTranscoders", () => {
        it("should fail if caller is not Controller owner", async () => {
            await expectThrow(bondingManager.setNumActiveTranscoders(7, {from: accounts[2]}))
        })

        it("should fail if provided numActiveTranscoders > current max size of transcoder pool", async () => {
            await expectThrow(bondingManager.setNumActiveTranscoders(11))
        })

        it("should set numActiveTranscoders", async () => {
            await bondingManager.setNumActiveTranscoders(4)

            assert.equal(await bondingManager.numActiveTranscoders.call(), 4, "wrong numActiveTranscoders")
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
        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
        })

        it("should fail if current round is not initialized", async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), false)

            await expectThrow(bondingManager.transcoder(5, 10, 1))
        })

        it("should fail if rewardCut is not a valid percentage <= 100%", async () => {
            await expectThrow(bondingManager.transcoder(PERC_DIVISOR + 1, 10, 1))
        })

        it("should fail if feeShare is not a valid percentage <= 100%", async () => {
            await expectThrow(bondingManager.transcoder(5, PERC_DIVISOR + 1, 1))
        })

        describe("transcoder is not already registered", () => {
            it("should fail if caller is not delegated to self with a non-zero bonded amount", async () => {
                await expectThrow(bondingManager.transcoder(5, 10, 1))
            })

            it("should set transcoder's pending rewardCut, feeShare, and pricePerSegment", async () => {
                await bondingManager.bond(1000, accounts[0])
                await bondingManager.transcoder(5, 10, 1)

                let tInfo = await bondingManager.getTranscoder(accounts[0])
                assert.equal(tInfo[1], 0, "wrong rewardCut")
                assert.equal(tInfo[2], 0, "wrong feeShare")
                assert.equal(tInfo[3], 0, "wrong pricePerSegment")
                assert.equal(tInfo[4], 5, "wrong pendingRewardCut")
                assert.equal(tInfo[5], 10, "wrong pendingFeeShare")
                assert.equal(tInfo[6], 1, "wrong pendingPricePerSegment")
            })

            describe("transcoder pool is not full", () => {
                it("should add new transcoder to the pool", async () => {
                    await bondingManager.bond(1000, accounts[0])
                    await bondingManager.transcoder(5, 10, 1)

                    assert.equal(await bondingManager.getTranscoderPoolSize(), 1, "wrong transcoder pool size")
                    assert.equal(await bondingManager.getFirstTranscoderInPool(), accounts[0], "wrong first transcoder in pool")
                    assert.equal(await bondingManager.transcoderTotalStake(accounts[0]), 1000, "wrong transcoder total stake")
                })

                it("should add multiple additional transcoders to the pool", async () => {
                    await bondingManager.bond(2000, accounts[0])
                    await bondingManager.transcoder(5, 10, 1)
                    await bondingManager.bond(1000, accounts[1], {from: accounts[1]})
                    await bondingManager.transcoder(5, 10, 1, {from: accounts[1]})

                    assert.equal(await bondingManager.getTranscoderPoolSize(), 2, "wrong transcoder pool size")
                    assert.equal(await bondingManager.getFirstTranscoderInPool(), accounts[0], "wrong first transcoder in pool")
                    assert.equal(await bondingManager.getNextTranscoderInPool(accounts[0]), accounts[1], "wrong second transcoder in pool")
                    assert.equal(await bondingManager.transcoderTotalStake(accounts[0]), 2000, "wrong first transcoder total stake")
                    assert.equal(await bondingManager.transcoderTotalStake(accounts[1]), 1000, "wrong second transcoder total stake")
                })
            })

            describe("transcoder pool is full", () => {
                it("should fail if caller has insufficient delegated stake (less than transcoder with least delegated stake)", async () => {
                    const transcoders = accounts.slice(0, 5)
                    const newTranscoder = accounts[5]

                    await Promise.all(transcoders.map(account => {
                        return bondingManager.bond(2000, account, {from: account}).then(() => {
                            return bondingManager.transcoder(5, 10, 1, {from: account})
                        })
                    }))

                    // Caller bonds 600 - less than transcoder with least delegated stake
                    await bondingManager.bond(600, newTranscoder, {from: newTranscoder})

                    await expectThrow(bondingManager.transcoder(5, 10, 1, {from: newTranscoder}))
                })

                it("should fail if caller has insufficient delegated stake (same as transcoder with least delegated stake)", async () => {
                    const transcoders = accounts.slice(0, 5)
                    const newTranscoder = accounts[5]

                    await Promise.all(transcoders.map(account => {
                        return bondingManager.bond(2000, account, {from: account}).then(() => {
                            return bondingManager.transcoder(5, 10, 1, {from: account})
                        })
                    }))

                    // Caller bonds 2000 - same as transcoder with least delegated stake
                    await bondingManager.bond(2000, newTranscoder, {from: newTranscoder})

                    await expectThrow(bondingManager.transcoder(5, 10, 1, {from: newTranscoder}))
                })

                it("should evict the transcoder with the least delegated stake and add new transcoder to the pool", async () => {
                    const transcoders = accounts.slice(0, 5)
                    const newTranscoder = accounts[5]

                    await Promise.all(transcoders.map((account, idx) => {
                        return bondingManager.bond(1000 * (idx + 1), account, {from: account}).then(() => {
                            return bondingManager.transcoder(5, 10, 1, {from: account})
                        })
                    }))

                    // Caller bonds 3000 - more transcoder with least delegated stake
                    await bondingManager.bond(6000, newTranscoder, {from: newTranscoder})
                    await bondingManager.transcoder(5, 10, 1, {from: newTranscoder})

                    assert.equal(await bondingManager.transcoderStatus(newTranscoder), TranscoderStatus.Registered, "caller should be registered as transocder")
                    assert.equal(await bondingManager.getTranscoderPoolSize(), 5, "wrong transcoder pool size")
                    assert.equal(await bondingManager.transcoderTotalStake(newTranscoder), 6000, "wrong transcoder total stake")
                    assert.equal(await bondingManager.transcoderStatus(accounts[0]), TranscoderStatus.NotRegistered, "transcoder with least delegated stake should be evicted")
                })
            })
        })

        describe("transcoder is already registered", () => {
            it("should update transcoder's pending rewardCut, feeShare, and pricePerSegment", async () => {
                await bondingManager.bond(1000, accounts[0])
                await bondingManager.transcoder(5, 10, 1)

                let tInfo = await bondingManager.getTranscoder(accounts[0])
                assert.equal(tInfo[1], 0, "wrong rewardCut")
                assert.equal(tInfo[2], 0, "wrong feeShare")
                assert.equal(tInfo[3], 0, "wrong pricePerSegment")
                assert.equal(tInfo[4], 5, "wrong pendingRewardCut")
                assert.equal(tInfo[5], 10, "wrong pendingFeeShare")
                assert.equal(tInfo[6], 1, "wrong pendingPricePerSegment")

                await bondingManager.transcoder(10, 15, 4)

                tInfo = await bondingManager.getTranscoder(accounts[0])
                assert.equal(tInfo[1], 0, "wrong rewardCut")
                assert.equal(tInfo[2], 0, "wrong feeShare")
                assert.equal(tInfo[3], 0, "wrong pricePerSegment")
                assert.equal(tInfo[4], 10, "wrong pendingRewardCut")
                assert.equal(tInfo[5], 15, "wrong pendingFeeShare")
                assert.equal(tInfo[6], 4, "wrong pendingPricePerSegment")
            })

            describe("current round is in lock period", () => {
                beforeEach(async () => {
                    await bondingManager.bond(1000, accounts[0], {from: accounts[0]})
                    await bondingManager.transcoder(5, 10, 2, {from: accounts[0]})
                    await bondingManager.bond(1000, accounts[1], {from: accounts[1]})
                    await bondingManager.transcoder(5, 10, 5, {from: accounts[1]})

                    await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), true)
                })

                it("should fail if caller is not a registered transcoder", async () => {
                    await expectThrow(bondingManager.transcoder(5, 10, 6, {from: accounts[2]}))
                })

                it("should fail if provided pricePerSegment is > previously set pendingPricePerSegment", async () => {
                    await expectThrow(bondingManager.transcoder(5, 10, 6, {from: accounts[1]}))
                })

                it("should fail if provided pricePerSegment is < current price floor", async () => {
                    await expectThrow(bondingManager.transcoder(5, 10, 1, {from: accounts[1]}))
                })

                it("should set new pricePerSegment that is >= current price floor and <= previously set pendingPricePerSegment", async () => {
                    // Note that the provided rewardCut and feeShare values will have no effect
                    await bondingManager.transcoder(3, 11, 2, {from: accounts[1]})

                    const tInfo = await bondingManager.getTranscoder(accounts[1])
                    assert.equal(tInfo[4], 5, "should not change pendingRewardCut")
                    assert.equal(tInfo[5], 10, "should not change pendingFeeShare")
                    assert.equal(tInfo[6], 2, "should change pendingPricePerSegment to provided value")
                })
            })
        })
    })

    describe("bond", () => {
        const transcoder0 = accounts[0]
        const transcoder1 = accounts[1]
        const nonTranscoder = accounts[2]
        const delegator = accounts[3]
        const currentRound = 100

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)

            await bondingManager.bond(1000, transcoder0, {from: transcoder0})
            await bondingManager.transcoder(5, 10, 1, {from: transcoder0})
            await bondingManager.bond(2000, transcoder1, {from: transcoder1})
            await bondingManager.transcoder(5, 10, 1, {from: transcoder1})
            await bondingManager.bond(1000, nonTranscoder, {from: nonTranscoder})
        })

        it("should fail if current round is not initialized", async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), false)

            await expectThrow(bondingManager.bond(1000, transcoder0, {from: delegator}))
        })

        describe("caller is unbonded or unbonding", () => {
            it("should set startRound to the next round and set withdrawRound to 0", async () => {
                await bondingManager.bond(1000, transcoder0, {from: delegator})

                const dInfo = await bondingManager.getDelegator(delegator)
                assert.equal(dInfo[4], currentRound + 1, "wrong startRound")
                assert.equal(dInfo[5], 0, "wrong withdrawRound")
            })

            it("should set delegate", async () => {
                await bondingManager.bond(1000, transcoder0, {from: delegator})

                assert.equal((await bondingManager.getDelegator(delegator))[2], transcoder0, "wrong delegateAddress")
            })

            it("should update delegate's position in transcoder pool if it is a transcoder", async () => {
                await bondingManager.bond(3000, transcoder0, {from: delegator})

                assert.equal((await bondingManager.getFirstTranscoderInPool()), transcoder0, "did not correctly update position in transcoder pool")
            })

            describe("caller has a bonded amount", () => {
                beforeEach(async () => {
                    await bondingManager.bond(1000, transcoder0, {from: delegator})

                    await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
                    await bondingManager.unbond({from: delegator})
                })

                describe("caller is just moving bonded stake because provided amount = 0", () => {
                    it("should update delegate and not update bonded amount or total bonded tokens", async () => {
                        const startDelegatedAmount = (await bondingManager.getDelegator(transcoder0))[3]
                        const startBondedAmount = (await bondingManager.getDelegator(delegator))[0]
                        const startTotalBonded = await bondingManager.getTotalBonded()
                        await bondingManager.bond(0, transcoder0, {from: delegator})
                        const endDelegatedAmount = (await bondingManager.getDelegator(transcoder0))[3]
                        const endBondedAmount = (await bondingManager.getDelegator(delegator))[0]
                        const endTotalBonded = await bondingManager.getTotalBonded()

                        assert.equal(endDelegatedAmount.sub(startDelegatedAmount), 1000, "wrong change in delegatedAmount")
                        assert.equal(endBondedAmount.sub(startBondedAmount), 0, "bondedAmount change should be 0")
                        assert.equal(endTotalBonded.sub(startTotalBonded), 0, "totalBonded change should be 0")
                    })
                })

                describe("caller is increasing and moving bonded stake because provided amount > 0", () => {
                    it("should update delegate, bonded amount and total bonded tokens", async () => {
                        const startDelegatedAmount = (await bondingManager.getDelegator(transcoder0))[3]
                        const startBondedAmount = (await bondingManager.getDelegator(delegator))[0]
                        const startTotalBonded = await bondingManager.getTotalBonded()
                        await bondingManager.bond(1000, transcoder0, {from: delegator})
                        const endBondedAmount = (await bondingManager.getDelegator(delegator))[0]
                        const endTotalBonded = await bondingManager.getTotalBonded()
                        const endDelegatedAmount = (await bondingManager.getDelegator(transcoder0))[3]

                        assert.equal(endDelegatedAmount.sub(startDelegatedAmount), 2000, "wrong change in delegatedAmount")
                        assert.equal(endBondedAmount.sub(startBondedAmount), 1000, "bondedAmount change should be 0")
                        assert.equal(endTotalBonded.sub(startTotalBonded), 1000, "totalBonded change should be 0")
                    })
                })
            })

            describe("caller does not have a bonded amount", () => {
                it("should fail if provided amount = 0", async () => {
                    await expectThrow(bondingManager.bond(0, transcoder0, {from: delegator}))
                })

                it("should update delegate, bonded amount and total bonded tokenst", async () => {
                    const startDelegatedAmount = (await bondingManager.getDelegator(transcoder0))[3]
                    const startTotalBonded = await bondingManager.getTotalBonded()
                    await bondingManager.bond(1000, transcoder0, {from: delegator})
                    const endDelegatedAmount = (await bondingManager.getDelegator(transcoder0))[3]
                    const endTotalBonded = await bondingManager.getTotalBonded()

                    assert.equal(endDelegatedAmount.sub(startDelegatedAmount), 1000, "wrong change in delegatedAmount")
                    assert.equal((await bondingManager.getDelegator(delegator))[0], 1000, "wrong bondedAmount")
                    assert.equal(endTotalBonded.sub(startTotalBonded), 1000, "wrong change in totalBonded")
                })
            })
        })

        describe("caller is bonded", () => {
            beforeEach(async () => {
                await bondingManager.bond(2000, transcoder0, {from: delegator})
                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
            })

            describe("caller is changing delegate", () => {
                it("should set startRound to next round", async () => {
                    await bondingManager.bond(0, transcoder1, {from: delegator})

                    assert.equal((await bondingManager.getDelegator(delegator))[4], currentRound + 2, "wrong startRound")
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

                it("should update old delegate's position in the transcoder pool if old delegate is a transcoder", async () => {
                    await bondingManager.bond(0, transcoder1, {from: delegator})

                    // Old delegate was previously first transcoder in pool and now no longer is
                    assert.isOk(await bondingManager.getFirstTranscoderInPool() != transcoder0, "did not correctly update position in pool")
                })

                it("should update new delegate's position in transcoder pool if it is a transcoder", async () => {
                    await bondingManager.bond(0, transcoder1, {from: delegator})

                    // New delegate was not previously first transcoder in pool and now is
                    assert.equal(await bondingManager.getFirstTranscoderInPool(), transcoder1, "did not correctly update position in pool")
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

                    it("should not update total bonded tokens", async () => {
                        const startTotalBonded = await bondingManager.getTotalBonded()
                        await bondingManager.bond(0, transcoder1, {from: delegator})
                        const endTotalBonded = await bondingManager.getTotalBonded()

                        assert.equal(endTotalBonded.sub(startTotalBonded), 0, "totalBonded change should be 0")
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

                it("should update total bonded tokens", async () => {
                    const startTotalBonded = await bondingManager.getTotalBonded()
                    await bondingManager.bond(1000, transcoder0, {from: delegator})
                    const endTotalBonded = await bondingManager.getTotalBonded()

                    assert.equal(endTotalBonded.sub(startTotalBonded), 1000, "wrong change in totalBonded")
                })
            })
        })
    })

    describe("unbond", () => {
        const transcoder = accounts[0]
        const delegator = accounts[1]
        const currentRound = 100

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)

            await bondingManager.bond(1000, transcoder, {from: transcoder})
            await bondingManager.transcoder(5, 10, 1, {from: transcoder})
            await bondingManager.bond(1000, transcoder, {from: delegator})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
            await fixture.roundsManager.execute(bondingManager.address, functionSig("setActiveTranscoders()"))
        })

        it("should fail if current round is not initialized", async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), false)

            await expectThrow(bondingManager.unbond({from: delegator}))
        })

        it("should fail if the caller is not bonded", async () => {
            await bondingManager.unbond({from: delegator})

            // This should fail because caller is already unbonded and not bonded
            await expectThrow(bondingManager.unbond({from: delegator}))
        })

        it("should unbond delegator", async () => {
            const startDelegatedAmount = (await bondingManager.getDelegator(transcoder))[3]
            await bondingManager.unbond({from: delegator})
            const endDelegatedAmount = (await bondingManager.getDelegator(transcoder))[3]

            assert.equal((await bondingManager.getDelegator(delegator))[6], currentRound + 1, "should set lastClaimRound to current round")

            const unbondingPeriod = await bondingManager.unbondingPeriod.call()
            const withdrawRound = currentRound + 1 + unbondingPeriod.toNumber()
            assert.equal((await bondingManager.getDelegator(delegator))[5].toNumber(), withdrawRound, "should set withdrawRound to current round + unbondingPeriod")

            assert.equal(startDelegatedAmount.sub(endDelegatedAmount), 1000, "should decrease delegate's delegatedAmount")

            const dInfo = await bondingManager.getDelegator(delegator)
            assert.equal(dInfo[2], constants.NULL_ADDRESS, "should set delegateAddress to null address")
            assert.equal(dInfo[4], 0, "should set startRound to 0")
        })

        describe("caller is a registered transcoder", () => {
            it("should resign a transcoder", async () => {
                await bondingManager.unbond({from: transcoder})

                assert.equal(await bondingManager.transcoderStatus(transcoder), TranscoderStatus.NotRegistered, "should remove transcoder from pool")
            })

            describe("caller is an active transcoder for the current round", () => {
                it("should set active transcoder as inactive for the round", async () => {
                    assert.isOk(await bondingManager.isActiveTranscoder(transcoder, currentRound + 1), "transcoder should be active before unbonding")

                    const startTotalActiveStake = await bondingManager.getTotalActiveStake(currentRound + 1)
                    await bondingManager.unbond({from: transcoder})
                    const endTotalActiveStake = await bondingManager.getTotalActiveStake(currentRound + 1)

                    assert.isNotOk(await bondingManager.isActiveTranscoder(transcoder, currentRound + 1), "should set active transcoder as inactive for the round")
                    assert.equal(startTotalActiveStake.sub(endTotalActiveStake).toNumber(), 2000, "should decrease total active stake by total stake of transcoder")
                })
            })
        })
    })

    describe("withdrawStake", () => {
        const transcoder = accounts[0]
        const delegator = accounts[1]
        const currentRound = 100

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)

            await bondingManager.bond(1000, transcoder, {from: transcoder})
            await bondingManager.transcoder(5, 10, 1, {from: transcoder})
            await bondingManager.bond(1000, transcoder, {from: delegator})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
            await bondingManager.unbond({from: delegator})
        })

        it("should fail if system is paused", async () => {
            await fixture.controller.pause()

            await expectThrow(bondingManager.withdrawStake({from: delegator}))
        })

        it("should fail if current round is not initialized", async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), false)

            await expectThrow(bondingManager.withdrawStake({from: delegator}))
        })

        it("should fail if caller is not unbonded", async () => {
            await bondingManager.bond(100, transcoder, {from: delegator})

            // This should fail because caller is now in the pending state
            await expectThrow(bondingManager.withdrawStake({from: delegator}))
        })

        it("should withdraw caller's bonded stake", async () => {
            const unbondingPeriod = await bondingManager.unbondingPeriod.call()
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1 + unbondingPeriod.toNumber())
            await bondingManager.withdrawStake({from: delegator})

            const dInfo = await bondingManager.getDelegator(delegator)
            assert.equal(dInfo[0], 0, "should set bondedAmount to 0")
            assert.equal(dInfo[5], 0, "should set withdrawRound to 0")
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
            await bondingManager.transcoder(5, 10, 1, {from: transcoder0})
            await bondingManager.bond(1000, transcoder1, {from: transcoder1})
            await bondingManager.transcoder(5, 10, 1, {from: transcoder1})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
            await fixture.roundsManager.execute(bondingManager.address, functionSig("setActiveTranscoders()"))
            await fixture.jobsManager.execute(
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

            await expectThrow(bondingManager.withdrawFees({from: transcoder0}))
        })

        it("should fail if current round is not initialized", async () => {
            await fixture.roundsManager.setMockUint256(functionSig("currentRoundInitialized()"), false)

            await expectThrow(bondingManager.withdrawFees({from: transcoder0}))
        })

        it("should fail if there are no fees to withdraw", async () => {
            await expectThrow(bondingManager.withdrawFees({from: transcoder1}))
        })

        it("should withdraw caller's fees", async () => {
            await bondingManager.claimEarnings(currentRound + 1, {from: transcoder0})
            assert.isAbove((await bondingManager.getDelegator(transcoder0))[1], 0, "caller should have non-zero fees")

            await bondingManager.withdrawFees({from: transcoder0})

            const dInfo = await bondingManager.getDelegator(transcoder0)
            assert.equal(dInfo[6], currentRound + 1, "should set caller's lastClaimRound")
            assert.equal(dInfo[1], 0, "should set caller's fees to zero")
        })
    })

    describe("setActiveTranscoders", () => {
        const transcoder0 = accounts[0]
        const transcoder1 = accounts[1]
        const currentRound = 100

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)

            await bondingManager.bond(1000, transcoder0, {from: transcoder0})
            await bondingManager.transcoder(5, 10, 1, {from: transcoder0})
            await bondingManager.bond(1000, transcoder1, {from: transcoder1})
            await bondingManager.transcoder(5, 10, 1, {from: transcoder1})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
        })

        it("should fail if system is paused", async () => {
            await fixture.controller.pause()

            await expectThrow(fixture.roundsManager.execute(bondingManager.address, functionSig("setActiveTranscoders()")))
        })

        it("should fail if caller is not RoundsManager", async () => {
            await expectThrow(bondingManager.setActiveTranscoders())
        })

        it("should set the active transcoder set for the current round", async () => {
            await fixture.roundsManager.execute(bondingManager.address, functionSig("setActiveTranscoders()"))

            const tInfo0 = await bondingManager.getTranscoder(transcoder0)
            assert.equal(tInfo0[1], tInfo0[4].toNumber(), "should set blockRewardCut to pendingBlockRewardCut")
            assert.equal(tInfo0[2], tInfo0[5].toNumber(), "should set feeShare to pendingFeeShare")
            assert.equal(tInfo0[3], tInfo0[6].toNumber(), "should set pricePerSegment to pendingPricePerSegment")
            const earningsPool0 = await bondingManager.getTranscoderEarningsPoolForRound(transcoder0, currentRound + 1)
            assert.equal(earningsPool0[0], 0, "should set rewards in earnings pool to 0")
            assert.equal(earningsPool0[1], 0, "should set fees in earnings pool to 0")
            assert.equal(earningsPool0[2], 1000, "should set total stake for earnings pool to transcoder's total stake for the round")
            assert.equal(earningsPool0[3], 1000, "should set claimable stake for earnings pool to current total stake")
            assert.isOk(await bondingManager.isActiveTranscoder(transcoder0, currentRound + 1), "should set transcoder as active for current round")

            const tInfo1 = await bondingManager.getTranscoder(transcoder1)
            assert.equal(tInfo1[1], tInfo1[4].toNumber(), "should set blockRewardCut to pendingBlockRewardCut")
            assert.equal(tInfo1[2], tInfo1[5].toNumber(), "should set feeShare to pendingFeeShare")
            assert.equal(tInfo1[3], tInfo1[6].toNumber(), "should set pricePerSegment to pendingPricePerSegment")
            const earningsPool1 = await bondingManager.getTranscoderEarningsPoolForRound(transcoder1, currentRound + 1)
            assert.equal(earningsPool1[0], 0, "should set rewards in earnings pool to 0")
            assert.equal(earningsPool1[1], 0, "should set fees in earnings pool to 0")
            assert.equal(earningsPool1[2], 1000, "should set total stake for earnings pool to transcoder's total stake for the round")
            assert.equal(earningsPool1[3], 1000, "should set claimable stake for earnings pool to current total stake")
            assert.isOk(await bondingManager.isActiveTranscoder(transcoder1, currentRound + 1), "should set transcoder as active for current round")

            assert.equal(await bondingManager.getTotalActiveStake(currentRound + 1), 2000, "should set total active stake to sum of total stake of all active transcoders")
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
            await bondingManager.transcoder(5, 10, 1, {from: transcoder})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
            await fixture.roundsManager.execute(bondingManager.address, functionSig("setActiveTranscoders()"))
            await fixture.minter.setMockUint256(functionSig("createReward(uint256,uint256)"), 1000)
        })

        it("should fail if system is paused", async () => {
            await fixture.controller.pause()

            await expectThrow(bondingManager.reward({from: transcoder}))
        })

        it("should fail if current round is not initialized", async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), false)

            await expectThrow(bondingManager.reward({from: transcoder}))
        })

        it("should fail if caller is not an active transcoder for the current round", async () => {
            await expectThrow(bondingManager.reward({from: nonTranscoder}))
        })

        it("should fail if caller already called reward during the current round", async () => {
            await bondingManager.reward({from: transcoder})

            // This should fail because transcoder already called reward during the current round
            await expectThrow(bondingManager.reward({from: transcoder}))
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
            await bondingManager.transcoder(5, 10, 1, {from: transcoder})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
        })

        it("should fail if system is paused", async () => {
            await fixture.controller.pause()

            await expectThrow(
                fixture.jobsManager.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "updateTranscoderWithFees(address,uint256,uint256)",
                        ["address", "uint256", "uint256"],
                        [transcoder, 1000, currentRound + 1]
                    )
                )
            )
        })

        it("should fail if caller is not JobsManager", async () => {
            await expectThrow(bondingManager.updateTranscoderWithFees(transcoder, 1000, currentRound + 1))
        })

        it("should fail if transcoder is not registered", async () => {
            await expectThrow(
                fixture.jobsManager.execute(
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
            await fixture.jobsManager.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder, 1000, currentRound + 1]
                )
            )

            const earningsPool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 1)
            assert.equal(earningsPool[1], 1000, "should update fees in earnings pool for current round")
        })
    })

    describe("slashTranscoder", () => {
        const transcoder = accounts[0]
        const finder = accounts[1]
        const currentRound = 100

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)

            await bondingManager.bond(1000, transcoder, {from: transcoder})
            await bondingManager.transcoder(5, 10, 1, {from: transcoder})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
            await fixture.roundsManager.execute(bondingManager.address, functionSig("setActiveTranscoders()"))
        })

        it("should fail if system is paused", async () => {
            await fixture.controller.pause()

            await expectThrow(
                fixture.jobsManager.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [transcoder, constants.NULL_ADDRESS, PERC_DIVISOR / 2, PERC_DIVISOR / 2]
                    )
                )
            )
        })

        it("should fail if caller is not JobsManager", async () => {
            await expectThrow(bondingManager.slashTranscoder(transcoder, constants.NULL_ADDRESS, PERC_DIVISOR / 2, PERC_DIVISOR / 2))
        })

        it("decreases transcoder's bondedAmount", async () => {
            const startBondedAmount = (await bondingManager.getDelegator(transcoder))[0]
            await fixture.jobsManager.execute(
                bondingManager.address,
                functionEncodedABI(
                    "slashTranscoder(address,address,uint256,uint256)",
                    ["address", "uint256", "uint256", "uint256"],
                    [transcoder, constants.NULL_ADDRESS, PERC_DIVISOR / 2, 0]
                )
            )
            const endBondedAmount = (await bondingManager.getDelegator(transcoder))[0]

            assert.equal(endBondedAmount, startBondedAmount.div(2).toNumber(), "should decrease transcoder's bondedAmount by slashAmount")
        })

        describe("transcoder is bonded", () => {
            it("updates delegated amount and total bonded tokens", async () => {
                const startTotalBonded = await bondingManager.getTotalBonded()
                await fixture.jobsManager.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [transcoder, constants.NULL_ADDRESS, PERC_DIVISOR / 2, 0]
                    )
                )
                const endTotalBonded = await bondingManager.getTotalBonded()

                assert.equal((await bondingManager.getDelegator(transcoder))[3], 500, "should decrease delegatedAmount for transcoder by slash amount")
                assert.equal(startTotalBonded.sub(endTotalBonded), 500, "should decrease total bonded tokens by slash amount")
            })
        })

        describe("transcoder is registered", () => {
            it("removes transcoder from the pool", async () => {
                await fixture.jobsManager.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "slashTranscoder(address,address,uint256,uint256)",
                        ["address", "uint256", "uint256", "uint256"],
                        [transcoder, constants.NULL_ADDRESS, PERC_DIVISOR / 2, 0]
                    )
                )

                assert.equal(await bondingManager.transcoderStatus(transcoder), TranscoderStatus.NotRegistered, "should remove transcoder from the pool")
            })

            describe("transcoder is active", () => {
                it("removes transcoder from active set for the current round", async () => {
                    const startTotalActiveStake = await bondingManager.getTotalActiveStake(currentRound + 1)
                    await fixture.jobsManager.execute(
                        bondingManager.address,
                        functionEncodedABI(
                            "slashTranscoder(address,address,uint256,uint256)",
                            ["address", "uint256", "uint256", "uint256"],
                            [transcoder, constants.NULL_ADDRESS, PERC_DIVISOR / 2, 0]
                        )
                    )
                    const endTotalActiveStake = await bondingManager.getTotalActiveStake(currentRound + 1)

                    assert.isNotOk(await bondingManager.isActiveTranscoder(transcoder, currentRound + 1), "should set active transcoder as inactive for the round")
                    assert.equal(startTotalActiveStake.sub(endTotalActiveStake).toNumber(), 1000, "should decrease total active stake by total stake of transcoder")
                })
            })
        })

        describe("invoked with a finder", () => {
            it("slashes transcoder and rewards finder", async () => {
                let e = bondingManager.TranscoderSlashed({transcoder: transcoder})

                e.watch(async (err, res) => {
                    e.stopWatching()

                    assert.equal(res.args.finder, finder, "should fire TranscoderSlashed event with finder")
                    assert.equal(res.args.penalty, 500, "should fire TranscoderSlashed event with slashed amount penalty")
                    assert.equal(res.args.finderReward, 250, "should fire TranscoderSlashed event with finder reward computed with finderFee")
                })

                await fixture.jobsManager.execute(
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
                let e = bondingManager.TranscoderSlashed({transcoder: transcoder})

                e.watch(async (err, res) => {
                    e.stopWatching()

                    assert.equal(res.args.finder, constants.NULL_ADDRESS, "should fire TranscoderSlashed event with null finder")
                    assert.equal(res.args.penalty, 500, "should fire TranscoderSlashed event with slashed amount penalty")
                    assert.equal(res.args.finderReward, 0, "should fire TranscoderSlashed event with finder reward of 0")
                })

                await fixture.jobsManager.execute(
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

    describe("electActiveTranscoder", () => {
        const transcoder0 = accounts[0]
        const transcoder1 = accounts[1]
        const currentRound = 100

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)

            await bondingManager.bond(1000, transcoder0, {from: transcoder0})
            await bondingManager.transcoder(5, 10, 5, {from: transcoder0})
            await bondingManager.bond(1000, transcoder1, {from: transcoder1})
            await bondingManager.transcoder(5, 10, 10, {from: transcoder1})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
            await fixture.roundsManager.execute(bondingManager.address, functionSig("setActiveTranscoders()"))
        })

        it("should exclude transcoders with a price > provided maxPricePerSegment", async () => {
            assert.equal(
                await bondingManager.electActiveTranscoder(6, web3.sha3("foo"), currentRound + 1),
                transcoder0,
                "should exclude transcoder with price > provided maxPricePerSegment"
            )
        })

        it("should not exclude transcoders with a pirce = provided maxPricePerSegment", async () => {
            assert.equal(
                await bondingManager.electActiveTranscoder(5, web3.sha3("foo"), currentRound + 1),
                transcoder0,
                "should not exclude transcoder with price = provided maxPricePerSegment"
            )
        })

        it("should return null address if there are no transcoders with a price <= provided maxPricePerSegment", async () => {
            assert.equal(
                await bondingManager.electActiveTranscoder(2, web3.sha3("foo"), currentRound + 1),
                constants.NULL_ADDRESS,
                "should return null address if there are no transcoders with a price <= provided maxPricePerSegment"
            )
        })

        it("should return null address if there are no active transcoders", async () => {
            await bondingManager.unbond({from: transcoder0})
            await bondingManager.unbond({from: transcoder1})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 2)
            await fixture.roundsManager.execute(bondingManager.address, functionSig("setActiveTranscoders()"))

            assert.equal(
                await bondingManager.electActiveTranscoder(6, web3.sha3("foo"), currentRound + 2),
                constants.NULL_ADDRESS,
                "should return null address if there are no active transcoders"
            )
        })

        // There is already an integration test for the random weighted selection based on stake
        // TBD whether we should include a test for the weighted selection here as well...
    })

    describe("claimEarnings", () => {
        const transcoder = accounts[0]
        const delegator = accounts[1]
        const currentRound = 100

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)

            await bondingManager.bond(1000, transcoder, {from: transcoder})
            await bondingManager.transcoder(50 * PERC_MULTIPLIER, 25 * PERC_MULTIPLIER, 1, {from: transcoder})
            await bondingManager.bond(1000, transcoder, {from: delegator})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
            await fixture.roundsManager.execute(bondingManager.address, functionSig("setActiveTranscoders()"))
            await fixture.jobsManager.execute(
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

        it("should fail if system is paused", async () => {
            await fixture.controller.pause()

            await expectThrow(bondingManager.claimEarnings(currentRound + 1, {from: delegator}))
        })

        it("should fail if current round is not initialized", async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), false)

            await expectThrow(bondingManager.claimEarnings(currentRound + 1, {from: delegator}))
        })

        it("should fail if provided endRound is before caller's lastClaimRound", async () => {
            await expectThrow(bondingManager.claimEarnings(currentRound - 1, {from: delegator}))
        })

        it("should fail if provided endRound is in the future", async () => {
            await expectThrow(bondingManager.claimEarnings(currentRound + 2, {from: delegator}))
        })

        it("updates caller's lastClaimRound", async () => {
            await bondingManager.claimEarnings(currentRound + 1, {from: delegator})

            assert.equal((await bondingManager.getDelegator(delegator))[6], currentRound + 1, "should update caller's lastClaimRound to the current round")
        })

        describe("caller has a delegate", () => {
            it("should fail if endRound - lastClaimRound > maxEarningsClaimsRounds (too many rounds to claim through)", async () => {
                const maxEarningsClaimsRounds = await bondingManager.maxEarningsClaimsRounds.call()
                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + maxEarningsClaimsRounds.toNumber() + 1)

                await expectThrow(bondingManager.claimEarnings(currentRound + 21, {from: delegator}))
            })

            it("should claim earnings for 1 round", async () => {
                const startDInfo = await bondingManager.getDelegator(delegator)
                await bondingManager.claimEarnings(currentRound + 1, {from: delegator})
                const endDInfo = await bondingManager.getDelegator(delegator)

                // Claimed rewards
                const claimedRewards = 250
                assert.equal(endDInfo[0].sub(startDInfo[0]), claimedRewards, "should increase bondedAmount by claimed rewards for round")
                // Claimed fees
                const claimedFees = 125
                assert.equal(endDInfo[1].sub(startDInfo[1]), claimedFees, "should increase fees by claimed fees for round")
                const earningsPool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 1)
                assert.equal(earningsPool[0], 1000 - claimedRewards, "should decrease rewards in earningsPool by delegator's claimed rewards for round")
                assert.equal(earningsPool[1], 1000 - claimedFees, "should decrease fees in earningsPool by delegator's claimed fees for round")
                assert.equal(earningsPool[3], 1000, "should decrease claimableStake for earningsPool by delegator's stake for round")
            })

            it("should claim earnings for > 1 round", async () => {
                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 2)
                await fixture.roundsManager.execute(bondingManager.address, functionSig("setActiveTranscoders()"))
                await fixture.jobsManager.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "updateTranscoderWithFees(address,uint256,uint256)",
                        ["address", "uint256", "uint256"],
                        [transcoder, 1000, currentRound + 2]
                    )
                )
                await fixture.minter.setMockUint256(functionSig("createReward(uint256,uint256)"), 1000)
                await bondingManager.reward({from: transcoder})

                const startDInfo = await bondingManager.getDelegator(delegator)
                await bondingManager.claimEarnings(currentRound + 2, {from: delegator})
                const endDInfo = await bondingManager.getDelegator(delegator)

                // Claimed rewards
                const claimedRewards0 = 250
                const claimedRewards1 = Math.floor((500 * (1250 * PERC_DIVISOR / 3000)) / PERC_DIVISOR)
                assert.equal(endDInfo[0].sub(startDInfo[0]), claimedRewards0 + claimedRewards1, "should increase bondedAmount by claimed rewards for 2 rounds")
                // Claimed fees
                const claimedFees0 = 125
                const claimedFees1 = Math.floor((250 * (1250 * PERC_DIVISOR / 3000)) / PERC_DIVISOR)
                assert.equal(endDInfo[1].sub(startDInfo[1]), claimedFees0 + claimedFees1, "should increase fees by claimed fees for 2 rounds")
                const earningsPool0 = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 1)
                assert.equal(earningsPool0[0], 1000 - claimedRewards0, "should decrease rewards in earningsPool by delegator's claimed rewards for first round")
                assert.equal(earningsPool0[1], 1000 - claimedFees0, "should decrease fees in earningsPool by delegator's claimed fees for first round")
                assert.equal(earningsPool0[3], 1000, "should decrease claimableStake for earningsPool by delegator's stake for first round")
                const earningsPool1 = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 2)
                assert.equal(earningsPool1[0], 1000 - claimedRewards1, "should decrease rewards in earningsPool by delegator's claimed rewards for second round")
                assert.equal(earningsPool1[1], 1000 - claimedFees1, "should decrease fees in earningsPool by delegator's claimed fees for second round")
                assert.equal(earningsPool1[3], 3000 - 1250, "should decrease claimableStake for earningsPool by delegator's stake for second round")
            })

            describe("caller is a transcoder", () => {
                it("should claim earnings as both a delegator and a transcoder", async () => {
                    const startDInfo = await bondingManager.getDelegator(transcoder)
                    await bondingManager.claimEarnings(currentRound + 1, {from: transcoder})
                    const endDInfo = await bondingManager.getDelegator(transcoder)

                    // Claimed rewards
                    const claimedRewards = 500 + 250
                    assert.equal(endDInfo[0].sub(startDInfo[0]), claimedRewards, "should increase bondedAmount by claimed rewards for round")
                    // Claimed fees
                    const claimedFees = 750 + 125
                    assert.equal(endDInfo[1].sub(startDInfo[1]), claimedFees, "should increase fees by claimed fees for round")
                    const earningsPool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 1)
                    assert.equal(earningsPool[0], 1000 - claimedRewards, "should decrease rewards in earningsPool by transcoder's claimed rewards for round")
                    assert.equal(earningsPool[1], 1000 - claimedFees, "should decrease fees in earningsPool by transcoder's claimed fees for round")
                    assert.equal(earningsPool[3], 1000, "should decrease claimableStake for earningsPool by transcoder's stake for round")
                })

                it("should claim earnings and empty remaining earnings in pool as both a delegator and a transcoder", async () => {
                    await bondingManager.claimEarnings(currentRound + 1, {from: delegator})
                    await bondingManager.claimEarnings(currentRound + 1, {from: transcoder})

                    const earningsPool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder, currentRound + 1)
                    assert.equal(earningsPool[0], 0, "should set rewards to 0 in earningsPool for round after all delegators have claimed earnings")
                    assert.equal(earningsPool[1], 0, "should set fees to 0 in earningsPool for round after all delegators have claimed earnings")
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
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)

            await bondingManager.bond(1000, transcoder, {from: transcoder})
            await bondingManager.transcoder(50 * PERC_MULTIPLIER, 25 * PERC_MULTIPLIER, 1, {from: transcoder})
            await bondingManager.bond(1000, transcoder, {from: delegator})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
            await fixture.roundsManager.execute(bondingManager.address, functionSig("setActiveTranscoders()"))
            await fixture.jobsManager.execute(
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
            await fixture.roundsManager.execute(bondingManager.address, functionSig("setActiveTranscoders()"))
            await fixture.jobsManager.execute(
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
            await expectThrow(bondingManager.pendingStake(delegator, currentRound + 3))
        })

        it("should fail if endRound is before lastClaimRound", async () => {
            await expectThrow(bondingManager.pendingStake(delegator, currentRound - 1))
        })

        it("should fail if endRound = lastClaimRound", async () => {
            await expectThrow(bondingManager.pendingStake(delegator, currentRound))
        })

        it("should return pending rewards for 1 round", async () => {
            const pendingRewards0 = 250

            assert.equal(
                await bondingManager.pendingStake(delegator, currentRound + 1),
                1000 + pendingRewards0,
                "should return sum of bondedAmount and pending rewards for 1 round"
            )
        })

        it("should return pending rewards for > 1 round", async () => {
            const pendingRewards0 = 250
            const pendingRewards1 = Math.floor((500 * (1250 * PERC_DIVISOR / 3000)) / PERC_DIVISOR)

            assert.equal(
                await bondingManager.pendingStake(delegator, currentRound + 2),
                1000 + pendingRewards0 + pendingRewards1,
                "should return sum of bondedAmount and pending rewards for 2 rounds"
            )
        })

        describe("delegator is a transcoder", () => {
            it("should return pending rewards as both a delegator and a transcoder", async () => {
                const pendingRewards = 500 + 250

                assert.equal(
                    await bondingManager.pendingStake(transcoder, currentRound + 1),
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
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)

            await bondingManager.bond(1000, transcoder, {from: transcoder})
            await bondingManager.transcoder(50 * PERC_MULTIPLIER, 25 * PERC_MULTIPLIER, 1, {from: transcoder})
            await bondingManager.bond(1000, transcoder, {from: delegator})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
            await fixture.roundsManager.execute(bondingManager.address, functionSig("setActiveTranscoders()"))
            await fixture.jobsManager.execute(
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
            await fixture.roundsManager.execute(bondingManager.address, functionSig("setActiveTranscoders()"))
            await fixture.jobsManager.execute(
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

            assert.equal(await bondingManager.pendingFees(delegator, currentRound + 1), pendingFees0, "should return sum of collected fees and pending fees for 1 round")
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

    describe("transcoderStatus", () => {
        const transcoder = accounts[0]
        const currentRound = 100

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)

            await bondingManager.bond(1000, transcoder, {from: transcoder})
            await bondingManager.transcoder(5, 10, 1, {from: transcoder})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
        })

        describe("caller is not in transcoder pool", () => {
            it("returns NotRegistered", async () => {
                await bondingManager.unbond({from: transcoder})

                assert.equal(await bondingManager.transcoderStatus(transcoder), TranscoderStatus.NotRegistered, "should return NotRegistered for caller not in transcoder pool")
            })
        })

        describe("caller is in transcoder pool", () => {
            it("returns Registered", async () => {
                assert.equal(await bondingManager.transcoderStatus(transcoder), TranscoderStatus.Registered, "should return Registered for caller in transcoder pool")
            })
        })
    })

    describe("delegatorStatus", () => {
        const delegator0 = accounts[0]
        const delegator1 = accounts[1]
        const transcoder = accounts[2]
        const currentRound = 100

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)

            await bondingManager.bond(1000, delegator0, {from: delegator0})

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
        })

        describe("caller has a withdrawRound", () => {
            beforeEach(async () => {
                await bondingManager.unbond({from: delegator0})
            })

            describe("withdrawRound is now", () => {
                it("returns Unbonded", async () => {
                    const withdrawRound = (await bondingManager.getDelegator(delegator0))[5]
                    await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), withdrawRound)

                    assert.equal(await bondingManager.delegatorStatus(delegator0), DelegatorStatus.Unbonded, "should return Unbonded for delegator with withdrawRound now")
                })
            })

            describe("withdrawRound is in the past", () => {
                it("returns Unbonded", async () => {
                    const withdrawRound = (await bondingManager.getDelegator(delegator0))[5]
                    await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), withdrawRound + 1)

                    assert.equal(await bondingManager.delegatorStatus(delegator0), DelegatorStatus.Unbonded, "should return Unbonded for delegator with withdrawRound in past")
                })
            })

            describe("withdrawRound is in the future", () => {
                it("returns Unbonding", async () => {
                    assert.equal(await bondingManager.delegatorStatus(delegator0), DelegatorStatus.Unbonding, "should return Unbonded for delegator with withdrawRound in future")
                })
            })
        })

        describe("caller has a startRound", () => {
            beforeEach(async () => {
                await bondingManager.bond(0, transcoder, {from: delegator0})
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

        describe("caller does not have a startRound or a withdrawRound", () => {
            it("returns Unbonded", async () => {
                assert.equal(await bondingManager.delegatorStatus(delegator1), DelegatorStatus.Unbonded, "should return Unbonded for delegator that has not ever bonded")
            })
        })
    })
})
