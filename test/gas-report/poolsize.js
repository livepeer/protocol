import {contractId} from "../../utils/helpers"
import BN from "bn.js"

const Controller = artifacts.require("Controller")
const BondingManager = artifacts.require("BondingManager")
const AdjustableRoundsManager = artifacts.require("AdjustableRoundsManager")
const LivepeerToken = artifacts.require("LivepeerToken")

const TOKEN_UNIT = (new BN(10)).pow(new BN(18))
const transferAmount = new BN(10).mul(TOKEN_UNIT)

contract("gas report", accounts => {
    let controller
    let bondingManager
    let roundsManager
    let token

    let roundLength

    const createFullPool = async (size) => {
        const accs = accounts.slice(0, size)
        await Promise.all(accs.map((acc, i) => selfBond(acc, i + 1)))
    }
    
    const provisionDelegator = async (delegator, amount) => {
        await token.transfer(delegator, transferAmount)
        await token.approve(bondingManager.address, amount, {from: delegator})
    }

    const selfBond = async (delegator, amount) => {
        await provisionDelegator(delegator, amount)
        await bondingManager.bond(amount, delegator, {from: delegator})
    }

    before(async () => {
        controller = await Controller.deployed()

        const bondingManagerAddr = await controller.getContract(contractId("BondingManager"))
        bondingManager = await BondingManager.at(bondingManagerAddr)

        const roundsManagerAddr = await controller.getContract(contractId("RoundsManager"))
        roundsManager = await AdjustableRoundsManager.at(roundsManagerAddr)

        const tokenAddr = await controller.getContract(contractId("LivepeerToken"))
        token = await LivepeerToken.at(tokenAddr)

        roundLength = await roundsManager.roundLength.call()
    })

    const testWithPoolSize = size => {
        describe(`${size} transcoders`, () => {
            const newTranscoder = accounts[size]
            const newTranscoder2 = accounts[size + 1]
            const delegator1 = accounts[size + 2]
            const delegator2 = accounts[size + 3]
    
            contract("Transcoder", () => {
                // most expensive transcoder() call occurs when
                // - caller is not currently in pool
                // - pool is full
                // - caller has enough stake to join the pool at the last position
                // - caller's rewardCut and feeShare are currently 0
    
                // the transcoder to be evicted must unbond to take the last place
                before(async () => {
                    await controller.unpause()
                    await bondingManager.setNumActiveTranscoders(size)
                    await createFullPool(size)
                    await roundsManager.mineBlocks(roundLength.toNumber() * 1)
                    await roundsManager.initializeRound()
                    // bump up last transcoder's stake to '2'
                    // bond '2' to the new transcoder 
                    // then we can decrease the the stake for the second-to-last transcoder to '1'
                    // last we'll call 'transcoder()' for the new transcoder in the test itself
                    await provisionDelegator(accounts[0], 1)
                    await bondingManager.bond(1, accounts[0], {from: accounts[0]})
    
                    await provisionDelegator(newTranscoder, 2)
                    await bondingManager.bond(2, newTranscoder, {from: newTranscoder})
    
                    await bondingManager.unbond(1, {from: accounts[1]})
                })
    
                it("inserts an inactive transcoder in the last position", async () => {
                    await bondingManager.transcoder(1, 1, {from: newTranscoder})
                })
            })
    
            contract("Bond", () => {
    
                before(async () => {
                    await controller.unpause()
                    await bondingManager.setNumActiveTranscoders(size)
                    await createFullPool(size)
                    await roundsManager.mineBlocks(roundLength.toNumber() * 1)
                    await roundsManager.initializeRound()
                })
    
                describe("self bonding", () => {
                    before(async () => {
                        await provisionDelegator(newTranscoder, 2)
                        await provisionDelegator(newTranscoder2, size + 1)
                    })
    
                    it("insert new transcoder into the last position", async () => {
                        // The transcoder in the last position has a stake of '1'
                        await bondingManager.bond(2, newTranscoder, {from: newTranscoder})
                    })
            
                    it("insert new transcoder into the first position", async () => {
                        // first transcoder has a stake of 'size'
                        await bondingManager.bond(size + 1, newTranscoder2, {from: newTranscoder2})
                    })
                })
    
                describe("delegation", () => {
                    before(async () => {
                        await roundsManager.mineBlocks(roundLength.toNumber() * 1)
                        await roundsManager.initializeRound()
                        // if we run the entire test file first transcoder will be 'newTranscoder2'
                        // if we only run this describe block first transcoder will be 'accounts[size - 1]'
                        const first = await bondingManager.getFirstTranscoderInPool()
                        const unbondAmount = first == newTranscoder2 ? size : size - 1
                        await provisionDelegator(delegator1, unbondAmount)
                        await bondingManager.unbond(unbondAmount, {from: first})
                        await bondingManager.bond(unbondAmount, first, {from: delegator1})
                        await roundsManager.mineBlocks(roundLength.toNumber() * 1)
                        await roundsManager.initializeRound()
                    })
    
                    it("move first transcoder to last position and last transcoder to first position", async () => {
                        // if we run the entire test file last transcoder will be 'newTranscoder'
                        // if we run only this describe block last transcoder will be 'accounts[0]'
                        let last = newTranscoder
                        if ((await bondingManager.getDelegator(newTranscoder2)).bondedAmount.toNumber() == 0) last = accounts[0];
                        await bondingManager.bond(0, last, {from: delegator1})
                    })
    
                    it("delegate to first transcoder", async () => {
                        await provisionDelegator(delegator2, 100)
                        const first = await bondingManager.getFirstTranscoderInPool()
                        await bondingManager.bond(100, first, {from: delegator2})
                    })
                })
            })
    
            contract("Unbond", () => {
                // the first transcoder will be 'accounts[size - 1]'
                // the most expensive unbonding() call will be moving the first transcoder into the last position
                
                before(async () => {
                    await controller.unpause()
                    await bondingManager.setNumActiveTranscoders(size)
                    await createFullPool(size)
                    await roundsManager.mineBlocks(roundLength.toNumber() * 1)
                    await roundsManager.initializeRound()
    
                    // bump last transcoder's stake to 2
                    await provisionDelegator(accounts[0], 1)
                    await bondingManager.bond(1, accounts[0], {from: accounts[0]})
                })
    
                it("moves the first transcoder to the last position", async () => {
                    await bondingManager.unbond(size - 1, {from: accounts[size - 1]})
                })
    
                it("keeps the first transcoder in first position", async () => {
                    const first = await bondingManager.getFirstTranscoderInPool()
                    await bondingManager.unbond(1, {from: first})
                })
            })
    
            contract("Rebond", () => {
                // the most expensive rebond transaction is rebonding an evicted transcoder to take the last spot
                const unbondingLockID = 0
    
                before(async () => {
                    await controller.unpause()
                    await bondingManager.setNumActiveTranscoders(size)
                    await createFullPool(size)
                    await roundsManager.mineBlocks(roundLength.toNumber() * 1)
                    await roundsManager.initializeRound()
    
                    await provisionDelegator(accounts[0], 1)
                    await bondingManager.bond(1, accounts[0], {from: accounts[0]})
                    await bondingManager.unbond(1, {from: accounts[0]})
    
                    await provisionDelegator(newTranscoder, 2)
                    await bondingManager.bond(2, newTranscoder, {from: newTranscoder})
                    await roundsManager.mineBlocks(roundLength.toNumber() * 1)
                    await roundsManager.initializeRound()
                    await bondingManager.unbond(1, {from: newTranscoder})
    
                    // provision first spot test
                    await bondingManager.unbond(1, {from: accounts[size - 1]})
                })
    
                it("inserts a transcoder into the last spot", async () => {
                    await bondingManager.rebond(unbondingLockID, {from: accounts[0]})
                })
    
                it("keeps transcoder in first place", async () => {
                    await bondingManager.rebond(unbondingLockID, {from: accounts[size - 1]})
                })
            })
    
            contract("RebondFromUnbonded", () => {
                // the most expensive 'rebondFromUnbonded()' call occurs when we rebond to a transoder to that will take the last spot in the pool
                const unbondingLockID = 0
    
                before(async () => {
                    await controller.unpause()
                    await bondingManager.setNumActiveTranscoders(size)
                    await createFullPool(size)
                    await roundsManager.mineBlocks(roundLength.toNumber() * 1)
                    await roundsManager.initializeRound()
    
                    await provisionDelegator(accounts[0], 1)
                    await bondingManager.bond(1, accounts[0], {from: accounts[0]})
    
                    await roundsManager.mineBlocks(roundLength.toNumber() * 1)
                    await roundsManager.initializeRound()
    
                    await bondingManager.unbond(2, {from: accounts[0]})
    
                    await roundsManager.mineBlocks(roundLength.toNumber() * 1)
                    await roundsManager.initializeRound()
    
                    await provisionDelegator(newTranscoder, 1)
                    await bondingManager.bond(1, newTranscoder, {from: newTranscoder})
    
                    // provision first spot test
                    await provisionDelegator(accounts[size - 1], 1)
                    await bondingManager.bond(1, accounts[size - 1], {from: accounts[size - 1]})
                    await bondingManager.unbond(size + 1, {from: accounts[size - 1]})
                    await provisionDelegator(newTranscoder2, size)
                    await bondingManager.bond(size, newTranscoder2, {from: newTranscoder2})
                })
    
                it("inserts a transcoder back into the last spot", async () => {
                    await bondingManager.rebondFromUnbonded(accounts[0], unbondingLockID, {from: accounts[0]})
                })
    
                it("inserts a transcoder back into the first spot", async () => {
                    await bondingManager.rebondFromUnbonded(accounts[size - 1], unbondingLockID, {from: accounts[size - 1]})
                })
            })
    
            contract("Reward", () => {
                // The 'reward()' call is most expensive when 
                // - a transcoder hasn't called reward for more than 1 round
                // - hasn't received stake updates in the last round
                // - the transcoder is last in the list (updateKey first removes, then re-inserts)
                before(async () => {
                    await controller.unpause()
                    await bondingManager.setNumActiveTranscoders(size)
                    await createFullPool(size)
                    await roundsManager.mineBlocks(roundLength.toNumber() * 1)
                    await roundsManager.initializeRound()
    
                    // initialize an extra round so that 'lastActiveStakeUpdateRound > currentRound'
                    await roundsManager.mineBlocks(roundLength.toNumber() * 1)
                    await roundsManager.initializeRound()
                })
    
                it("updates the key for the last transcoder in the pool", async () => {
                    // 'accounts[0]' is the last transcoder in the pool
                    await bondingManager.reward({from: accounts[0]})
                })
            })
    
        })
    }


    testWithPoolSize(100)
    // testWithPoolSize(150)
    // testWithPoolSize(200)
    // testWithPoolSize(250)
    // testWithPoolSize(300)
})