import {contractId} from "../../utils/helpers"
import RPC from "../../utils/rpc"

const Controller = artifacts.require("Controller")
const BondingManager = artifacts.require("BondingManager")
const AdjustableRoundsManager = artifacts.require("AdjustableRoundsManager")
const LivepeerToken = artifacts.require("LivepeerToken")

contract("transcoder pool size gas report", accounts => {
    let rpc

    let controller
    let bondingManager
    let roundsManager
    let token

    let roundLength

    // Creates a full pool using the addresses in `accs`
    // Upon creation, the pool ordering (ascending from last position) is:
    // (accs[0], 1) -> (accs[1], 2) -> (accs[1], 3) -> ... -> (accs[accs.length - 1], accs.length)
    const createFullPool = async accs => {
        await bondingManager.setNumActiveTranscoders(accs.length)
        await Promise.all(accs.map((acc, i) => selfBond(acc, i + 1)))

        await roundsManager.mineBlocks(roundLength.toNumber())
        await roundsManager.initializeRound()
    }

    const approve = async (delegator, amount) => {
        await token.transfer(delegator, amount)
        await token.approve(bondingManager.address, amount, {from: delegator})
    }

    const selfBond = async (delegator, amount) => {
        await approve(delegator, amount)
        await bondingManager.bond(amount, delegator, {from: delegator})
    }

    before(async () => {
        rpc = new RPC(web3)

        controller = await Controller.deployed()

        const bondingManagerAddr = await controller.getContract(contractId("BondingManager"))
        bondingManager = await BondingManager.at(bondingManagerAddr)

        const roundsManagerAddr = await controller.getContract(contractId("RoundsManager"))
        roundsManager = await AdjustableRoundsManager.at(roundsManagerAddr)

        const tokenAddr = await controller.getContract(contractId("LivepeerToken"))
        token = await LivepeerToken.at(tokenAddr)

        roundLength = await roundsManager.roundLength.call()

        await controller.unpause()
    })

    const testWithPoolSize = size => {
        describe(`${size} transcoders`, () => {
            const transcoders = accounts.slice(0, size)
            const newTranscoder = accounts[size]
            const delegator = accounts[size + 1]

            let baseSnapshotID
            let testSnapshotID

            before(async () => {
                baseSnapshotID = await rpc.snapshot()

                await createFullPool(transcoders)
            })

            after(async () => {
                await rpc.revert(baseSnapshotID)
            })

            beforeEach(async () => {
                testSnapshotID = await rpc.snapshot()
            })

            afterEach(async () => {
                await rpc.revert(testSnapshotID)
            })

            describe("transcoder", () => {
                // The most expensive transcoder() call occurs when
                // - Caller is not currently in pool
                // - Pool is full
                // - Caller has enough stake to join the pool at the last position
                // - Caller's rewardCut and feeShare are currently 0

                describe("caller not in pool + full pool + join at last position + rewardCut/feeShare = 0", () => {
                    beforeEach(async () => {
                        // Increase transcoders[1] stake to 3
                        await approve(transcoders[1], 1)
                        await bondingManager.bond(1, transcoders[1], {from: transcoders[1]})

                        // Pool ordering (ascending from last position):
                        // (transcoders[0], 1) -> (transcoders[2], 3) -> (transcoders[1], 3)

                        // Increase transcoders[0] stake to 2
                        await approve(transcoders[0], 1)
                        await bondingManager.bond(1, transcoders[0], {from: transcoders[0]})

                        // Pool ordering (ascending from last position):
                        // (transcoders[0], 2) -> (transcoders[2], 3) -> (transcoders[1], 3)

                        // newTranscoder bonds 2 which is not enough to join the pool because the last transcoder's stake is 2
                        await approve(newTranscoder, 2)
                        await bondingManager.bond(2, newTranscoder, {from: newTranscoder})

                        // Decrease transcoders[0] stake to 1
                        await bondingManager.unbond(1, {from: transcoders[0]})

                        // Pool ordering (ascending from last position):
                        // (transcoders[0], 1) -> (transcoders[2], 3) -> (transcoders[1], 3)
                    })

                    it("insert a new transcoder in the last position and evict the last transcoder", async () => {
                        await bondingManager.transcoder(1, 1, {from: newTranscoder})
                    })
                })
            })

            describe("bond", () => {
                describe("self bonding", () => {
                    describe("new transcoder bonds enough to join at last position", () => {
                        beforeEach(async () => {
                            // Increase transcoders[1] stake to 3
                            await approve(transcoders[1], 1)
                            await bondingManager.bond(1, transcoders[1], {from: transcoders[1]})

                            // Pool ordering (ascending from last position):
                            // (transcoders[0], 1) -> (transcoders[2], 3) -> (transcoders[1], 3)

                            await approve(newTranscoder, 2)
                        })

                        it("insert new transcoder into the last position and evict the last transcoder", async () => {
                            await bondingManager.bond(2, newTranscoder, {from: newTranscoder})
                        })
                    })

                    describe("new transcoder bonds enough to join at first position", () => {
                        beforeEach(async () => {
                            await approve(newTranscoder, size + 1)
                        })

                        it("insert new transcoder into the first position and evict the last transcoder", async () => {
                            await bondingManager.bond(size + 1, newTranscoder, {from: newTranscoder})
                        })
                    })
                })

                describe("delegation", () => {
                    describe("delegator moving stake can drop first transcoder to last position", () => {
                        beforeEach(async () => {
                            // Increase transcoders[0] stake to 2
                            await approve(transcoders[0], 1)
                            await bondingManager.bond(1, transcoders[0], {from: transcoders[0]})

                            // Decrease transcoders[size - 1] stake by `size - 1` so that its stake becomes 1
                            const amount = size - 1
                            await bondingManager.unbond(amount, {from: transcoders[size - 1]})

                            // Pool ordering (ascending from last position):
                            // (transcoders[size - 1], 1) -> (transcoders[1], 2) -> (transcoders[0], 2)

                            // delegator delegates to transcoders[size - 1] and increases its stake back to `size`
                            // Now transcoders[size - 1] -> first transcoder
                            await approve(delegator, amount)
                            await bondingManager.bond(amount, transcoders[size - 1], {from: delegator})
                        })

                        it("move first transcoder to last position and last transcoder to first position", async () => {
                            await bondingManager.bond(0, transcoders[1], {from: delegator})
                        })
                    })

                    describe("delegator delegates to first transcoder", () => {
                        beforeEach(async () => {
                            await approve(delegator, 100)
                        })

                        it("delegate to first transcoder", async () => {
                            await bondingManager.bond(100, transcoders[size - 1], {from: delegator})
                        })
                    })
                })
            })

            describe("unbond", () => {
                // The most expensive unbond() call happens when the first transcoder is moved to the last position

                beforeEach(async () => {
                    // Increase transcoders[0] stake to 2
                    await approve(transcoders[0], 1)
                    await bondingManager.bond(1, transcoders[0], {from: transcoders[0]})

                    // Pool ordering (ascending from last position):
                    // (transcoders[1], 2) -> (transcoders[0], 2)
                })

                it("moves the first transcoder to the last position", async () => {
                    await bondingManager.unbond(size - 1, {from: transcoders[size - 1]})
                })

                it("keeps the first transcoder in first position", async () => {
                    await bondingManager.unbond(1, {from: transcoders[size - 1]})
                })
            })

            describe("rebond", () => {
                // The most expensive rebond() call happens when a transcoder not in the pool is inserted in the last position

                const unbondingLockID = 0

                describe("last transcoder can rebond and still be last", () => {
                    beforeEach(async () => {
                        await approve(transcoders[0], 1)
                        await bondingManager.bond(1, transcoders[0], {from: transcoders[0]})
                        await approve(transcoders[1], 1)
                        await bondingManager.bond(1, transcoders[1], {from: transcoders[1]})

                        // Pool order (ascending from last position):
                        // (transcoders[0], 2) -> (transcoders[2], 3) -> (transcoders[1], 3)

                        await bondingManager.unbond(1, {from: transcoders[0]})
                    })

                    it("inserts a transcoder into the last spot", async () => {
                        await bondingManager.rebond(unbondingLockID, {from: transcoders[0]})
                    })
                })

                describe("first transcoder can rebond and still be first", () => {
                    beforeEach(async () => {
                        await bondingManager.unbond(1, {from: transcoders[size - 1]})
                    })

                    it("keeps transcoder in first place", async () => {
                        await bondingManager.rebond(unbondingLockID, {from: transcoders[size - 1]})
                    })
                })
            })

            describe("rebondFromUnbonded", () => {
                // The most expensive rebondFromUnbonded() call occurs when a transcoder not in the pool is inserted in the last position

                const unbondingLockID = 0

                describe("last transcoder is unbonded", () => {
                    beforeEach(async () => {
                        // The last transcoder's stake is 1 so unbonding 1 will remove it from the pool
                        await bondingManager.unbond(1, {from: transcoders[0]})
                    })

                    it("inserts a transcoder back into the last spot", async () => {
                        await bondingManager.rebondFromUnbonded(transcoders[0], unbondingLockID, {from: transcoders[0]})
                    })
                })

                describe("first transcoder is unbonded", () => {
                    beforeEach(async () => {
                        // The first transcoder's stake is `size` so unbonding `size` will remove it from the pool
                        await bondingManager.unbond(size, {from: transcoders[size - 1]})
                    })

                    it("inserts a transcoder back into the first spot", async () => {
                        await bondingManager.rebondFromUnbonded(accounts[size - 1], unbondingLockID, {from: transcoders[size - 1]})
                    })
                })
            })

            describe("reward", () => {
                // The most expensive reward() call occurs when:
                // - The transcoder hasn't called reward for more than 1 round
                // - The transcoder hasn't received stake updates in the last round
                // - The transcoder is in the last position in the list

                describe("called by last transcoder", () => {
                    beforeEach(async () => {
                        // Initialize an extra round so that the transcoder's lastActiveStakeUpdateRound < currentRound
                        await roundsManager.mineBlocks(roundLength.toNumber())
                        await roundsManager.initializeRound()

                        // All transcoders besides transcoders[0] (the last position) call reward
                        const rewardTranscoders = transcoders.slice(1)
                        for (let tr of rewardTranscoders) {
                            await bondingManager.reward({from: tr})
                        }
                    })

                    it("updates the key for the last transcoder in the pool", async () => {
                        await bondingManager.reward({from: transcoders[0]})
                    })
                })
            })
        })
    }

    testWithPoolSize(100)
    testWithPoolSize(200)
    testWithPoolSize(300)
})
