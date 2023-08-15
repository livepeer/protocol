import Fixture from "./helpers/Fixture"
import {contractId, functionSig} from "../../utils/helpers"
import {assert} from "chai"
import {ethers, web3} from "hardhat"
import chai from "chai"
import {solidity} from "ethereum-waffle"
import {BigNumber, constants} from "ethers"

chai.use(solidity)
const {expect} = chai

describe("BondingVotes", () => {
    let signers
    let fixture

    let bondingVotes
    let roundsManager

    const PERC_DIVISOR = 1000000

    const setRound = async round => {
        await fixture.roundsManager.setMockUint256(
            functionSig("currentRound()"),
            round
        )
    }

    const inRound = async (round, fn) => {
        const previous = await roundsManager.currentRound()
        try {
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                round
            )
            await fn()
        } finally {
            await fixture.roundsManager.setMockUint256(
                functionSig("currentRound()"),
                previous
            )
        }
    }

    before(async () => {
        signers = await ethers.getSigners()
        fixture = new Fixture(web3)
        await fixture.deploy()

        roundsManager = await ethers.getContractAt(
            "RoundsManager",
            fixture.roundsManager.address
        )

        const BondingVotesFac = await ethers.getContractFactory("BondingVotes")

        bondingVotes = await fixture.deployAndRegister(
            BondingVotesFac,
            "BondingVotes",
            fixture.controller.address
        )
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    const encodeCheckpointBondingState = ({
        account,
        startRound,
        bondedAmount,
        delegateAddress,
        delegatedAmount,
        lastClaimRound,
        lastRewardRound
    }) => {
        return bondingVotes.interface.encodeFunctionData(
            "checkpointBondingState",
            [
                account,
                startRound,
                bondedAmount,
                delegateAddress,
                delegatedAmount,
                lastClaimRound,
                lastRewardRound
            ]
        )
    }

    const encodeCheckpointTotalActiveStake = (totalStake, round) => {
        return bondingVotes.interface.encodeFunctionData(
            "checkpointTotalActiveStake",
            [totalStake, round]
        )
    }

    const customErrorAbi = (sig, args) => {
        const iface = new ethers.utils.Interface([`function ${sig}`])
        const funcDataHex = iface.encodeFunctionData(sig, args)
        const abi = Buffer.from(funcDataHex, "hex")
        return abi.toString()
    }

    describe("checkpointTotalActiveStake", () => {
        let currentRound

        beforeEach(async () => {
            currentRound = 100

            await setRound(currentRound)
        })

        it("should fail if BondingManager is not the caller", async () => {
            const tx = bondingVotes
                .connect(signers[2])
                .checkpointTotalActiveStake(1337, currentRound)
            await expect(tx).to.be.revertedWith(
                `InvalidCaller("${signers[2].address}", "${fixture.bondingManager.address}")`
            )
        })

        it("should fail if checkpointing after current round", async () => {
            const functionData = encodeCheckpointTotalActiveStake(
                1337,
                currentRound + 1
            )

            await expect(
                fixture.bondingManager.execute(
                    bondingVotes.address,
                    functionData
                )
            ).to.be.revertedWith(
                customErrorAbi("FutureCheckpoint(uint256,uint256)", [
                    currentRound + 1,
                    currentRound
                ])
            )
        })

        it("should allow checkpointing in the current round", async () => {
            const functionData = encodeCheckpointTotalActiveStake(
                1337,
                currentRound
            )

            await fixture.bondingManager.execute(
                bondingVotes.address,
                functionData
            )

            assert.equal(
                await bondingVotes.getTotalActiveStakeAt(currentRound),
                1337
            )
        })
    })

    describe("getTotalActiveStakeAt", () => {
        let currentRound

        beforeEach(async () => {
            currentRound = 100

            await setRound(currentRound)
        })

        it("should fail if round is after the next round", async () => {
            const tx = bondingVotes.getTotalActiveStakeAt(currentRound + 2)
            await expect(tx).to.be.revertedWith(
                `FutureLookup(${currentRound + 2}, ${currentRound + 1})`
            )
        })

        it("should fail if there are no checkpointed rounds", async () => {
            const tx = bondingVotes.getTotalActiveStakeAt(currentRound)
            await expect(tx).to.be.revertedWith("NoRecordedCheckpoints()")
        })

        it("should fail to query before the first checkpoint", async () => {
            const functionData = encodeCheckpointTotalActiveStake(
                1337,
                currentRound - 1
            )
            await fixture.bondingManager.execute(
                bondingVotes.address,
                functionData
            )

            const tx = bondingVotes.getTotalActiveStakeAt(currentRound - 2)
            await expect(tx).to.be.revertedWith(
                `PastLookup(${currentRound - 2}, ${currentRound - 1})`
            )
        })

        it("should query checkpointed value in the current round", async () => {
            const functionData = encodeCheckpointTotalActiveStake(
                1337,
                currentRound
            )
            await fixture.bondingManager.execute(
                bondingVotes.address,
                functionData
            )

            assert.equal(
                await bondingVotes.getTotalActiveStakeAt(currentRound),
                1337
            )
        })

        it("should query next rounds value from next round total active stake", async () => {
            const functionData = encodeCheckpointTotalActiveStake(
                1337,
                currentRound - 5
            )
            await fixture.bondingManager.execute(
                bondingVotes.address,
                functionData
            )
            await fixture.bondingManager.setMockUint256(
                functionSig("nextRoundTotalActiveStake()"),
                1674
            )

            const totalStakeAt = r =>
                bondingVotes.getTotalActiveStakeAt(r).then(bn => bn.toString())

            assert.equal(await totalStakeAt(currentRound - 3), "1674")
            assert.equal(await totalStakeAt(currentRound), "1674")
            assert.equal(await totalStakeAt(currentRound + 1), "1674")
        })

        it("should allow querying the past checkpointed values", async () => {
            const roundStakes = [
                [500, currentRound - 5],
                [1000, currentRound - 4],
                [1500, currentRound - 3],
                [2000, currentRound - 2],
                [2500, currentRound - 1]
            ]

            for (const [totalStake, round] of roundStakes) {
                const functionData = encodeCheckpointTotalActiveStake(
                    totalStake,
                    round
                )
                await fixture.bondingManager.execute(
                    bondingVotes.address,
                    functionData
                )
            }

            // now check all past values that must be recorded
            for (const [expectedStake, round] of roundStakes) {
                assert.equal(
                    await bondingVotes.getTotalActiveStakeAt(round),
                    expectedStake
                )
            }
        })

        it("should use the next checkpointed round values for intermediate queries", async () => {
            const roundStakes = [
                [500, currentRound - 50],
                [1000, currentRound - 40],
                [1500, currentRound - 30],
                [2000, currentRound - 20],
                [2500, currentRound - 10]
            ]

            for (const [totalStake, round] of roundStakes) {
                const functionData = encodeCheckpointTotalActiveStake(
                    totalStake,
                    round
                )
                await fixture.bondingManager.execute(
                    bondingVotes.address,
                    functionData
                )
            }

            // now query 1 round in between each of the checkpoints
            for (const idx = 1; idx < roundStakes.length; idx++) {
                const [expectedStake, round] = roundStakes[idx]
                assert.equal(
                    await bondingVotes.getTotalActiveStakeAt(round - 1 - idx),
                    expectedStake
                )
            }
        })
    })

    describe("checkpointBondingState", () => {
        let transcoder
        let currentRound

        beforeEach(async () => {
            transcoder = signers[0]
            currentRound = 100

            await setRound(currentRound)
        })

        it("should fail if BondingManager is not the caller", async () => {
            const tx = bondingVotes
                .connect(signers[4])
                .checkpointBondingState(
                    transcoder.address,
                    currentRound + 1,
                    1000,
                    transcoder.address,
                    1000,
                    currentRound,
                    0
                )
            await expect(tx).to.be.revertedWith(
                `InvalidCaller("${signers[4].address}", "${fixture.bondingManager.address}")`
            )
        })

        it("should fail if checkpointing after next round", async () => {
            const functionData = encodeCheckpointBondingState({
                account: transcoder.address,
                startRound: currentRound + 2,
                bondedAmount: 1000,
                delegateAddress: transcoder.address,
                delegatedAmount: 1000,
                lastClaimRound: currentRound + 1,
                lastRewardRound: 0
            })

            await expect(
                fixture.bondingManager.execute(
                    bondingVotes.address,
                    functionData
                )
            ).to.be.revertedWith(
                customErrorAbi("FutureCheckpoint(uint256,uint256)", [
                    currentRound + 2,
                    currentRound + 1
                ])
            )
        })

        it("should fail if lastClaimRound is not lower than start round", async () => {
            const functionData = encodeCheckpointBondingState({
                account: transcoder.address,
                startRound: currentRound,
                bondedAmount: 1000,
                delegateAddress: transcoder.address,
                delegatedAmount: 1000,
                lastClaimRound: currentRound,
                lastRewardRound: 0
            })

            await expect(
                fixture.bondingManager.execute(
                    bondingVotes.address,
                    functionData
                )
            ).to.be.revertedWith(
                customErrorAbi("FutureLastClaimRound(uint256,uint256)", [
                    currentRound,
                    currentRound - 1
                ])
            )
        })

        it("should allow checkpointing in the next round", async () => {
            const functionData = encodeCheckpointBondingState({
                account: transcoder.address,
                startRound: currentRound + 1,
                bondedAmount: 1000,
                delegateAddress: transcoder.address,
                delegatedAmount: 1000,
                lastClaimRound: currentRound - 1,
                lastRewardRound: 0
            })
            await fixture.bondingManager.execute(
                bondingVotes.address,
                functionData
            )
        })

        it("should checkpoint account state", async () => {
            const functionData = encodeCheckpointBondingState({
                account: transcoder.address,
                startRound: currentRound + 1,
                bondedAmount: 1000,
                delegateAddress: transcoder.address,
                delegatedAmount: 1000,
                lastClaimRound: currentRound - 1,
                lastRewardRound: 0
            })
            await fixture.bondingManager.execute(
                bondingVotes.address,
                functionData
            )

            assert.deepEqual(
                await bondingVotes
                    .getBondingStateAt(transcoder.address, currentRound + 1)
                    .then(t => t.map(v => v.toString())),
                ["1000", transcoder.address]
            )
        })

        it("should be callable multiple times for the same round", async () => {
            const makeCheckpoint = async amount => {
                const functionData = encodeCheckpointBondingState({
                    account: transcoder.address,
                    startRound: currentRound + 1,
                    bondedAmount: amount,
                    delegateAddress: transcoder.address,
                    delegatedAmount: amount,
                    lastClaimRound: currentRound,
                    lastRewardRound: 0
                })
                await fixture.bondingManager.execute(
                    bondingVotes.address,
                    functionData
                )
            }

            await makeCheckpoint(1000)

            // simulating a bond where bonding manager checkpoints the current state and then the next
            await makeCheckpoint(2000)

            assert.deepEqual(
                await bondingVotes
                    .getBondingStateAt(transcoder.address, currentRound + 1)
                    .then(t => t.map(v => v.toString())),
                ["2000", transcoder.address]
            )
        })

        describe("events", () => {
            let transcoder2
            let delegator
            let currentRound

            beforeEach(async () => {
                transcoder2 = signers[1]
                delegator = signers[2]
                currentRound = 100

                await setRound(currentRound)
            })

            const makeCheckpoint = async (
                account,
                delegateAddress,
                bondedAmount,
                delegatedAmount
            ) => {
                const functionData = encodeCheckpointBondingState({
                    account,
                    startRound: currentRound + 1,
                    bondedAmount,
                    delegateAddress,
                    delegatedAmount,
                    lastClaimRound: currentRound,
                    lastRewardRound: 0
                })
                return await fixture.bondingManager.execute(
                    bondingVotes.address,
                    functionData
                )
            }

            it("should send events for delegator", async () => {
                // Changing both bondedAmount and delegateAddress
                let tx = await makeCheckpoint(
                    delegator.address,
                    transcoder.address,
                    1000,
                    0
                )

                // This will be sent on the transcoder state checkpoint instead
                await expect(tx).not.to.emit(
                    bondingVotes,
                    "DelegateVotesChanged"
                )

                await expect(tx)
                    .to.emit(bondingVotes, "DelegateChanged")
                    .withArgs(
                        delegator.address,
                        constants.AddressZero,
                        transcoder.address
                    )
                await expect(tx)
                    .to.emit(bondingVotes, "DelegatorVotesChanged")
                    .withArgs(delegator.address, 0, 1000)

                // Changing only bondedAmount
                tx = await makeCheckpoint(
                    delegator.address,
                    transcoder.address,
                    2000,
                    0
                )

                await expect(tx).not.to.emit(bondingVotes, "DelegateChanged")
                await expect(tx)
                    .to.emit(bondingVotes, "DelegatorVotesChanged")
                    .withArgs(delegator.address, 1000, 2000)

                // Changing only delegateAddress
                tx = await makeCheckpoint(
                    delegator.address,
                    transcoder2.address,
                    2000,
                    0
                )

                await expect(tx).not.to.emit(
                    bondingVotes,
                    "DelegatorVotesChanged"
                )
                await expect(tx)
                    .to.emit(bondingVotes, "DelegateChanged")
                    .withArgs(
                        delegator.address,
                        transcoder.address,
                        transcoder2.address
                    )
            })

            it("should send events for transcoder", async () => {
                // Changing both bondedAmount and delegateAddress
                let tx = await makeCheckpoint(
                    transcoder.address,
                    transcoder.address,
                    20000,
                    50000
                )

                await expect(tx)
                    .to.emit(bondingVotes, "DelegateChanged")
                    .withArgs(
                        transcoder.address,
                        constants.AddressZero,
                        transcoder.address
                    )
                await expect(tx)
                    .to.emit(bondingVotes, "DelegateVotesChanged")
                    .withArgs(transcoder.address, 0, 50000)
                // Still emits a delegator event
                await expect(tx)
                    .to.emit(bondingVotes, "DelegatorVotesChanged")
                    .withArgs(transcoder.address, 0, 20000)

                // Changing only delegatedAmount
                tx = await makeCheckpoint(
                    transcoder.address,
                    transcoder.address,
                    20000,
                    70000
                )

                await expect(tx).not.to.emit(bondingVotes, "DelegateChanged")
                await expect(tx).not.to.emit(
                    bondingVotes,
                    "DelegatorVotesChanged"
                )
                await expect(tx)
                    .to.emit(bondingVotes, "DelegateVotesChanged")
                    .withArgs(transcoder.address, 50000, 70000)

                // Changing delegateAddress, becoming a delegator itself
                tx = await makeCheckpoint(
                    transcoder.address,
                    transcoder2.address,
                    20000,
                    50000
                )

                await expect(tx)
                    .to.emit(bondingVotes, "DelegateChanged")
                    .withArgs(
                        transcoder.address,
                        transcoder.address,
                        transcoder2.address
                    )
                await expect(tx)
                    .to.emit(bondingVotes, "DelegateVotesChanged")
                    .withArgs(transcoder.address, 70000, 0)
                // Voting power as a delegator stayed the same
                await expect(tx).not.to.emit(
                    bondingVotes,
                    "DelegatorVotesChanged"
                )
            })
        })
    })

    describe("hasCheckpoint", () => {
        let transcoder
        let currentRound

        beforeEach(async () => {
            transcoder = signers[0]
            currentRound = 100

            await setRound(currentRound)
        })

        it("should return false for accounts without checkpoints", async () => {
            for (let i = 0; i < 10; i++) {
                assert.equal(
                    await bondingVotes.hasCheckpoint(signers[i].address),
                    false
                )
            }
        })

        it("should return true after one or more checkpoints are made", async () => {
            const makeCheckpoint = async startRound => {
                const functionData = encodeCheckpointBondingState({
                    account: transcoder.address,
                    startRound,
                    bondedAmount: 1000,
                    delegateAddress: transcoder.address,
                    delegatedAmount: 1000,
                    lastClaimRound: startRound - 1,
                    lastRewardRound: 0
                })
                await fixture.bondingManager.execute(
                    bondingVotes.address,
                    functionData
                )
            }

            for (let i = 0; i < 3; i++) {
                const round = currentRound + i
                await setRound(round)

                await makeCheckpoint(round + 1)

                assert.equal(
                    await bondingVotes.hasCheckpoint(transcoder.address),
                    true
                )
            }
        })
    })

    describe("getBondingStateAt", () => {
        let transcoder
        let delegator
        let currentRound

        beforeEach(async () => {
            transcoder = signers[0]
            delegator = signers[1]
            currentRound = 100

            await setRound(currentRound)
        })

        it("should fail if round is after the next round", async () => {
            const tx = bondingVotes.getBondingStateAt(
                delegator.address,
                currentRound + 2
            )
            await expect(tx).to.be.revertedWith(
                `FutureLookup(${currentRound + 2}, ${currentRound + 1})`
            )
        })

        describe("on missing checkpoints", () => {
            const setBondMock = async ({
                bondedAmount,
                delegateAddress,
                delegatedAmount,
                lastClaimRound // only required field
            }) =>
                await fixture.bondingManager.setMockDelegator(
                    delegator.address,
                    bondedAmount ?? 0,
                    0,
                    delegateAddress ?? constants.AddressZero,
                    delegatedAmount ?? 0,
                    0,
                    lastClaimRound,
                    0
                )

            const expectRevert = async queryRound => {
                const tx = bondingVotes.getBondingStateAt(
                    delegator.address,
                    queryRound
                )
                await expect(tx).to.be.revertedWith("NoRecordedCheckpoints()")
            }

            it("should fail if the account has a zero bond but updated on or after queried round", async () => {
                await setBondMock({lastClaimRound: currentRound - 10})
                await expectRevert(currentRound - 10)

                await setBondMock({lastClaimRound: currentRound - 9})
                await expectRevert(currentRound - 10)

                await setBondMock({lastClaimRound: currentRound - 5})
                await expectRevert(currentRound - 10)
            })

            it("should fail if the account has a non-zero bond", async () => {
                await setBondMock({
                    bondedAmount: 1,
                    lastClaimRound: currentRound - 1
                })
                await expectRevert(currentRound)

                await setBondMock({
                    delegatedAmount: 1,
                    lastClaimRound: currentRound - 1
                })
                await expectRevert(currentRound)
            })

            it("should succeed for never bonded (non-participant) accounts", async () => {
                expect(
                    await bondingVotes
                        .getBondingStateAt(delegator.address, currentRound)
                        .then(t => t.map(v => v.toString()))
                ).to.deep.equal(["0", constants.AddressZero])
            })

            it("should succeed for fully unbonded delegators before query round", async () => {
                await setBondMock({lastClaimRound: currentRound - 1})
                expect(
                    await bondingVotes
                        .getBondingStateAt(delegator.address, currentRound)
                        .then(t => t.map(v => v.toString()))
                ).to.deep.equal(["0", constants.AddressZero])
            })
        })

        describe("for transcoder", () => {
            const makeCheckpoint = (startRound, delegatedAmount) =>
                inRound(startRound - 1, async () => {
                    const functionData = encodeCheckpointBondingState({
                        account: transcoder.address,
                        startRound,
                        bondedAmount: 1, // doesn't matter, shouldn't be used
                        delegateAddress: transcoder.address,
                        delegatedAmount,
                        lastClaimRound: startRound - 1,
                        lastRewardRound: 0
                    })
                    await fixture.bondingManager.execute(
                        bondingVotes.address,
                        functionData
                    )
                })

            it("should disallow querying before the first checkpoint", async () => {
                await makeCheckpoint(currentRound, 1000)

                const tx = bondingVotes.getBondingStateAt(
                    transcoder.address,
                    currentRound - 2
                )
                await expect(tx).to.be.revertedWith(
                    `PastLookup(${currentRound - 2}, ${currentRound})`
                )
            })

            it("should return the same round delegatedAmount and own address", async () => {
                await makeCheckpoint(currentRound, 1000)

                assert.deepEqual(
                    await bondingVotes
                        .getBondingStateAt(transcoder.address, currentRound)
                        .then(t => t.map(v => v.toString())),
                    ["1000", transcoder.address]
                )
            })

            it("should return the last checkpoint before the queried round", async () => {
                await makeCheckpoint(currentRound - 10, 1000)
                await makeCheckpoint(currentRound - 5, 2000)

                assert.deepEqual(
                    await bondingVotes
                        .getBondingStateAt(transcoder.address, currentRound - 7)
                        .then(t => t.map(v => v.toString())),
                    ["1000", transcoder.address]
                )

                assert.deepEqual(
                    await bondingVotes
                        .getBondingStateAt(transcoder.address, currentRound)
                        .then(t => t.map(v => v.toString())),
                    ["2000", transcoder.address]
                )
            })
        })

        describe("for delegator", () => {
            let transcoder2

            const checkpointTranscoder = ({
                account,
                startRound,
                lastRewardRound
            }) =>
                inRound(startRound - 1, async () => {
                    const functionData = encodeCheckpointBondingState({
                        account,
                        startRound,
                        bondedAmount: 0, // not used in these tests
                        delegateAddress: account,
                        delegatedAmount: 0, // not used in these tests
                        lastClaimRound: startRound - 1,
                        lastRewardRound
                    })
                    await fixture.bondingManager.execute(
                        bondingVotes.address,
                        functionData
                    )
                })

            const setEarningPoolRewardFactor = async (
                address,
                round,
                factor
            ) => {
                await fixture.bondingManager.setMockTranscoderEarningsPoolForRound(
                    address,
                    round,
                    0,
                    0,
                    0,
                    factor,
                    0
                )
            }

            const checkpointDelegator = ({
                startRound,
                bondedAmount,
                delegateAddress,
                lastClaimRound
            }) =>
                inRound(startRound - 1, async () => {
                    const functionData = encodeCheckpointBondingState({
                        account: delegator.address,
                        startRound,
                        bondedAmount,
                        delegateAddress,
                        delegatedAmount: 0, // not used for delegators
                        lastClaimRound,
                        lastRewardRound: 0 // not used for delegators
                    })
                    await fixture.bondingManager.execute(
                        bondingVotes.address,
                        functionData
                    )
                })

            beforeEach(async () => {
                transcoder2 = signers[2]

                await checkpointTranscoder({
                    account: transcoder.address,
                    startRound: currentRound - 50,
                    lastRewardRound: 0
                })
                await checkpointTranscoder({
                    account: transcoder2.address,
                    startRound: currentRound - 50,
                    lastRewardRound: 0
                })
            })

            it("should disallow querying before the first checkpoint", async () => {
                await checkpointDelegator({
                    startRound: currentRound + 1,
                    bondedAmount: 1000,
                    delegateAddress: transcoder.address,
                    lastClaimRound: currentRound
                })

                const tx = bondingVotes.getBondingStateAt(
                    delegator.address,
                    currentRound
                )
                await expect(tx).to.be.revertedWith(
                    `PastLookup(${currentRound}, ${currentRound + 1})`
                )
            })

            it("should fail if there's no earning pool on the lastClaimRound", async () => {
                await checkpointDelegator({
                    startRound: currentRound - 10,
                    bondedAmount: 1000,
                    delegateAddress: transcoder.address,
                    lastClaimRound: currentRound - 11
                })

                const tx = bondingVotes.getBondingStateAt(
                    delegator.address,
                    currentRound
                )
                await expect(tx).to.be.revertedWith(
                    `MissingEarningsPool("${transcoder.address}", ${
                        currentRound - 11
                    })`
                )
            })

            it("should return the bonded amount if transcoder never called reward", async () => {
                await checkpointDelegator({
                    startRound: currentRound - 10,
                    bondedAmount: 1000,
                    delegateAddress: transcoder.address,
                    lastClaimRound: currentRound - 11
                })
                await setEarningPoolRewardFactor(
                    transcoder.address,
                    currentRound - 11,
                    PERC_DIVISOR
                )

                assert.deepEqual(
                    await bondingVotes
                        .getBondingStateAt(delegator.address, currentRound)
                        .then(t => t.map(v => v.toString())),
                    ["1000", transcoder.address]
                )
            })

            it("should return the last checkpoint before the queried round", async () => {
                await checkpointDelegator({
                    startRound: currentRound - 10,
                    bondedAmount: 1000,
                    delegateAddress: transcoder.address,
                    lastClaimRound: currentRound - 11
                })
                await setEarningPoolRewardFactor(
                    transcoder.address,
                    currentRound - 11,
                    PERC_DIVISOR
                )

                await checkpointDelegator({
                    startRound: currentRound - 5,
                    bondedAmount: 2000,
                    delegateAddress: transcoder2.address,
                    lastClaimRound: currentRound - 6
                })
                await setEarningPoolRewardFactor(
                    transcoder2.address,
                    currentRound - 6,
                    PERC_DIVISOR
                )

                assert.deepEqual(
                    await bondingVotes
                        .getBondingStateAt(delegator.address, currentRound - 7)
                        .then(t => t.map(v => v.toString())),
                    ["1000", transcoder.address]
                )

                assert.deepEqual(
                    await bondingVotes
                        .getBondingStateAt(delegator.address, currentRound)
                        .then(t => t.map(v => v.toString())),
                    ["2000", transcoder2.address]
                )
            })

            it("should return the same bonded amount if transcoder last called reward before claim round", async () => {
                await checkpointTranscoder({
                    account: transcoder.address,
                    startRound: currentRound,
                    lastRewardRound: currentRound - 10
                })
                await setEarningPoolRewardFactor(
                    transcoder.address,
                    currentRound - 10,
                    PERC_DIVISOR
                )

                await checkpointDelegator({
                    startRound: currentRound,
                    bondedAmount: 1000,
                    delegateAddress: transcoder.address,
                    lastClaimRound: currentRound - 1
                })
                await setEarningPoolRewardFactor(
                    transcoder.address,
                    currentRound - 1,
                    2 * PERC_DIVISOR
                )

                assert.deepEqual(
                    await bondingVotes
                        .getBondingStateAt(delegator.address, currentRound)
                        .then(t => t.map(v => v.toString())),
                    ["1000", transcoder.address]
                )
            })

            it("should fail if there's no earning pool on the lastRewardRound", async () => {
                await checkpointDelegator({
                    startRound: currentRound - 9,
                    bondedAmount: 1000,
                    delegateAddress: transcoder.address,
                    lastClaimRound: currentRound - 10
                })
                await setEarningPoolRewardFactor(
                    transcoder.address,
                    currentRound - 10,
                    PERC_DIVISOR
                )

                await checkpointTranscoder({
                    account: transcoder.address,
                    startRound: currentRound - 1,
                    lastRewardRound: currentRound - 2
                })
                // no earning pool for currentRound - 2

                const tx = bondingVotes.getBondingStateAt(
                    delegator.address,
                    currentRound
                )
                await expect(tx).to.be.revertedWith(
                    `MissingEarningsPool("${transcoder.address}", ${
                        currentRound - 2
                    })`
                )
            })

            it("should return the bonded amount with accrued pending rewards since lastClaimRound", async () => {
                await checkpointDelegator({
                    startRound: currentRound - 9,
                    bondedAmount: 1000,
                    delegateAddress: transcoder.address,
                    lastClaimRound: currentRound - 10
                })
                await setEarningPoolRewardFactor(
                    transcoder.address,
                    currentRound - 10,
                    PERC_DIVISOR
                )

                await checkpointTranscoder({
                    account: transcoder.address,
                    startRound: currentRound - 1,
                    lastRewardRound: currentRound - 2
                })
                await setEarningPoolRewardFactor(
                    transcoder.address,
                    currentRound - 2,
                    3 * PERC_DIVISOR
                )

                assert.deepEqual(
                    await bondingVotes
                        .getBondingStateAt(delegator.address, currentRound)
                        .then(t => t.map(v => v.toString())),
                    ["3000", transcoder.address]
                )
            })
        })
    })

    describe("IERC6372", () => {
        describe("clock", () => {
            let currentRound

            beforeEach(async () => {
                currentRound = 100

                await setRound(currentRound)
            })

            it("should return the current round", async () => {
                assert.equal(await bondingVotes.clock(), currentRound)

                await setRound(currentRound + 7)

                assert.equal(await bondingVotes.clock(), currentRound + 7)
            })
        })

        describe("CLOCK_MODE", () => {
            it("should return mode=livepeer_round", async () => {
                assert.equal(
                    await bondingVotes.CLOCK_MODE(),
                    "mode=livepeer_round"
                )
            })
        })
    })

    describe("IERC5805", () => {
        // redefine it here to avoid overriding top-level var
        let bondingVotes

        before(async () => {
            const HarnessFac = await ethers.getContractFactory(
                "BondingVotesERC5805Harness"
            )

            bondingVotes = await fixture.deployAndRegister(
                HarnessFac,
                "BondingVotes",
                fixture.controller.address
            )
        })

        // Same implementation as the BondingVotesERC5805Mock
        const mock = {
            getBondingStateAt: (_account, _round) => {
                const intAddr = BigNumber.from(_account)

                // lowest 4 bytes of address + _round
                const amount = intAddr.mask(32).add(_round)
                // (_account << 4) | _round
                const delegateAddress = intAddr.shl(4).mask(160).or(_round)

                return [
                    amount.toNumber(),
                    ethers.utils.getAddress(delegateAddress.toHexString())
                ]
            },
            getTotalActiveStakeAt: _round => 4 * _round
        }

        it("ensure harness was deployed", async () => {
            assert.equal(
                await fixture.controller.getContract(
                    contractId("BondingVotes")
                ),
                ethers.utils.getAddress(bondingVotes.address)
            )
        })

        describe("get(Past)?Votes", () => {
            it("getPastVotes should proxy to getBondingStateAt from next round", async () => {
                const testOnce = async (account, round) => {
                    const [expected] = mock.getBondingStateAt(
                        account.address,
                        round + 1
                    )

                    const votes = await bondingVotes.getPastVotes(
                        account.address,
                        round
                    )
                    assert.equal(votes.toNumber(), expected)
                }

                await testOnce(signers[0], 123)
                await testOnce(signers[1], 256)
                await testOnce(signers[2], 34784)
            })

            it("getVotes should query with the current round", async () => {
                const testOnce = async (account, round) => {
                    await fixture.roundsManager.setMockUint256(
                        functionSig("currentRound()"),
                        round
                    )
                    const [expected] = mock.getBondingStateAt(
                        account.address,
                        round + 1
                    )

                    const votes = await bondingVotes.getVotes(account.address)
                    assert.equal(votes.toNumber(), expected)
                }

                await testOnce(signers[3], 321)
                await testOnce(signers[4], 652)
                await testOnce(signers[5], 48743)
            })
        })

        describe("delegate(s|dAt)", () => {
            it("delegatedAt should proxy to BondingVotes.getBondingStateAt at next round", async () => {
                const testOnce = async (account, round) => {
                    const [, expected] = mock.getBondingStateAt(
                        account.address,
                        round + 1
                    )

                    const delegate = await bondingVotes.delegatedAt(
                        account.address,
                        round
                    )
                    assert.equal(delegate, expected)
                }

                await testOnce(signers[6], 123)
                await testOnce(signers[7], 256)
                await testOnce(signers[8], 34784)
            })

            it("delegates should query with the current round", async () => {
                const testOnce = async (account, round) => {
                    await fixture.roundsManager.setMockUint256(
                        functionSig("currentRound()"),
                        round
                    )
                    const [, expected] = mock.getBondingStateAt(
                        account.address,
                        round + 1
                    )

                    assert.equal(
                        await bondingVotes.delegates(account.address),
                        expected
                    )
                }

                await testOnce(signers[9], 321)
                await testOnce(signers[10], 652)
                await testOnce(signers[11], 48743)
            })
        })

        describe("getPastTotalSupply", () => {
            it("should proxy to getTotalActiveStakeAt at next round", async () => {
                const testOnce = async round => {
                    const expected = mock.getTotalActiveStakeAt(round + 1)

                    const totalSupply = await bondingVotes.getPastTotalSupply(
                        round
                    )
                    assert.equal(totalSupply.toNumber(), expected)
                }

                await testOnce(213)
                await testOnce(526)
                await testOnce(784347)
            })
        })

        describe("delegation", () => {
            it("should fail to call delegate", async () => {
                await expect(
                    bondingVotes
                        .connect(signers[0])
                        .delegate(signers[1].address)
                ).to.be.revertedWith("MustCallBondingManager(\"bond\")")
            })

            it("should fail to call delegateBySig", async () => {
                await expect(
                    bondingVotes.delegateBySig(
                        signers[1].address,
                        420,
                        1689794400,
                        171,
                        ethers.utils.hexZeroPad("0xfacade", 32),
                        ethers.utils.hexZeroPad("0xdeadbeef", 32)
                    )
                ).to.be.revertedWith("MustCallBondingManager(\"bondFor\")")
            })
        })
    })
})
