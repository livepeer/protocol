// test the earnings calculation for a combination of pre-LIP36 and post-LIP36 rounds.

import Fixture from "./helpers/Fixture"
import {contractId, functionSig, functionEncodedABI} from "../../utils/helpers"

const ManagerProxy = artifacts.require("ManagerProxy")
const BondingManagerV1 = artifacts.require("BondingManagerV1")
const BondingManager = artifacts.require("BondingManager")
const LinkedList = artifacts.require("SortedDoublyLL")

contract("LIP36 transition", accounts => {
    let fixture
    let proxy
    let bondingManager

    const NUM_ACTIVE_TRANSCODERS = 2
    const UNBONDING_PERIOD = 2
    const MAX_EARNINGS_CLAIMS_ROUNDS = 20

    const PERC_DIVISOR = 1000000
    const PERC_MULTIPLIER = PERC_DIVISOR / 100

    before(async () => {
        fixture = new Fixture(web3)
        await fixture.deploy()

        // Link DoubleSortedLL
        const ll = await LinkedList.new()
        BondingManagerV1.link("SortedDoublyLL", ll.address)
        BondingManager.link("SortedDoublyLL", ll.address)

        // deploy proxy
        proxy = await ManagerProxy.new(fixture.controller.address, contractId("BondingManager"))

        // deploy proxy target implementation
        await fixture.deployAndRegister(BondingManagerV1, "BondingManager", fixture.controller.address)

        // bind ABI to proxy
        bondingManager = await BondingManagerV1.at(proxy.address)

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

    describe("pendingStake", async () => {
        const transcoder = accounts[0]
        const delegator = accounts[1]
        const currentRound = 100

        beforeEach(async () => {
            await fixture.roundsManager.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture.roundsManager.setMockBool(functionSig("currentRoundLocked()"), false)

            // set reward amount
            await fixture.minter.setMockUint256(functionSig("createReward(uint256,uint256)"), 1000)

            // register transcoder
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound - 2)
            await bondingManager.bond(1000, transcoder, {from: transcoder})
            await bondingManager.transcoder(50 * PERC_MULTIPLIER, 25 * PERC_MULTIPLIER, {from: transcoder})
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound - 1)
            // delegate stake to transcoder
            await bondingManager.bond(1000, transcoder, {from: delegator})
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)

            // call reward (pre-LIP36)
            await bondingManager.reward({from: transcoder})

            // deploy LIP-36
            await fixture.deployAndRegister(BondingManager, "BondingManager", fixture.controller.address)
            bondingManager = await BondingManager.at(proxy.address)
            await bondingManager.setLIPUpgradeRound(36, currentRound)

            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
            await bondingManager.reward({from: transcoder})
        })

        describe("delegator", () => {
            it("should return pending rewards for a round before LIP-36", async () => {
                const pendingRewards0 = 250

                assert.equal(
                    (await bondingManager.pendingStake(delegator, currentRound)).toString(),
                    (1000 + pendingRewards0).toString(),
                    "should return sum of bondedAmount and pending rewards for 1 round"
                )
            })

            it("should return pending rewards for rounds both before and after LIP-36 combined", async () => {
                const pendingRewards0 = 250
                const pendingRewards1 = Math.floor((500 * (1250 * PERC_DIVISOR / 3000)) / PERC_DIVISOR)

                assert.equal(
                    (await bondingManager.pendingStake(delegator, currentRound + 1)).toString(),
                    1000 + pendingRewards0 + pendingRewards1,
                    "should return sum of bondedAmount and pending rewards for 2 rounds"
                )
            })

            it("should return pending rewards if delegator has already claimed since LIP-36", async () => {
                const pendingRewards0 = 250
                const pendingRewards1 = Math.floor((500 * (1250 * PERC_DIVISOR / 3000)) / PERC_DIVISOR)
                const pendingRewards2 = Math.floor((500 * (1458 * PERC_DIVISOR / 4000)) / PERC_DIVISOR)
                await bondingManager.claimEarnings(currentRound + 1, {from: delegator})
                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 2)

                await bondingManager.reward({from: transcoder})
                assert.equal((await bondingManager.pendingStake(delegator, currentRound + 2)).toString(), (1000 + pendingRewards0 + pendingRewards1 + pendingRewards2).toString())
            })
        })

        describe("transcoder", () => {
            it("should return pending rewards for a round before LIP-36", async () => {
                const pendingRewards = 250 + 500

                assert.equal(
                    (await bondingManager.pendingStake(transcoder, currentRound)).toNumber(),
                    1000 + pendingRewards,
                    "should return sum of bondedAmount and pending rewards as both a delegator and transcoder for a round"
                )
            })

            it("should return pending rewards for rounds both before and after LIP-36 combined", async () => {
                const cumulativeRewards = 500
                const pendingRewards0 = 250 + 500
                const pendingRewards1 = Math.floor((500 * (1750 * PERC_DIVISOR / 3000)) / PERC_DIVISOR)

                assert.equal(
                    (await bondingManager.pendingStake(transcoder, currentRound + 1)).toString(),
                    1000 + pendingRewards0 + pendingRewards1 + cumulativeRewards,
                    "should return sum of bondedAmount and pending rewards for 2 rounds"
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

            // register transcoder
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound - 2)
            await bondingManager.bond(1000, transcoder, {from: transcoder})
            await bondingManager.transcoder(50 * PERC_MULTIPLIER, 25 * PERC_MULTIPLIER, {from: transcoder})
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound - 1)
            // delegate stake to transcoder
            await bondingManager.bond(1000, transcoder, {from: delegator})
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound)

            // assign fees pre-LIP36
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

            // deploy LIP-36
            await fixture.deployAndRegister(BondingManager, "BondingManager", fixture.controller.address)
            bondingManager = await BondingManager.at(proxy.address)
            await bondingManager.setLIPUpgradeRound(36, currentRound)

            // assign fees post-LIP36
            await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 1)
            await fixture.ticketBroker.execute(
                bondingManager.address,
                functionEncodedABI(
                    "updateTranscoderWithFees(address,uint256,uint256)",
                    ["address", "uint256", "uint256"],
                    [transcoder, 1000, currentRound + 1]
                )
            )

            await bondingManager.reward({from: transcoder})
        })

        describe("delegator", () => {
            it("should return pending fees for a round before LIP-36", async () => {
                const pendingFees0 = 125

                assert.equal((await bondingManager.pendingFees(delegator, currentRound)).toString(), pendingFees0, "should return sum of collected fees and pending fees for 1 round")
            })

            it("should return pending fees for rounds both before and after LIP-36 combined", async () => {
                const pendingFees0 = 125
                const pendingFees1 = Math.floor((250 * (1250 * PERC_DIVISOR / 3000)) / PERC_DIVISOR)
                assert.equal(
                    (await bondingManager.pendingFees(delegator, currentRound + 1)).toNumber(),
                    pendingFees0 + pendingFees1,
                    "should return sum of collected fees and pending fees for 2 rounds"
                )
            })

            it("should return pending fees when transcoder has claimed earnings since LIP36", async () => {
                const pendingFees0 = 125
                const pendingFees1 = Math.floor((250 * (1250 * PERC_DIVISOR / 3000)) / PERC_DIVISOR)
                const pendingFees2 = Math.floor((250 * (1458 * PERC_DIVISOR / 4000)) / PERC_DIVISOR)

                await bondingManager.claimEarnings(currentRound + 1, {from: delegator})
                const del = await bondingManager.getDelegator(delegator)
                const fees = (await bondingManager.getDelegator(delegator)).fees
                assert.equal(pendingFees0 + pendingFees1, fees.toNumber(), "delegator fees not correct")
                await fixture.roundsManager.setMockUint256(functionSig("currentRound()"), currentRound + 2)

                await fixture.ticketBroker.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "updateTranscoderWithFees(address,uint256,uint256)",
                        ["address", "uint256", "uint256"],
                        [transcoder, 1000, currentRound + 2]
                    )
                )

                await fixture.ticketBroker.execute(
                    bondingManager.address,
                    functionEncodedABI(
                        "updateTranscoderWithFees(address,uint256,uint256)",
                        ["address", "uint256", "uint256"],
                        [transcoder, 1000, currentRound + 2]
                    )
                )

                assert.equal(
                    (await bondingManager.pendingFees(delegator, currentRound + 2)).toString(),
                    (pendingFees0+pendingFees1 + pendingFees2*2).toString()
                )
            })
        })

        describe("transcoder", () => {
            it("should return pending fees for a round before LIP-36", async () => {
                const pendingFees = 125 + 750

                assert.equal(
                    (await bondingManager.pendingFees(transcoder, currentRound )).toNumber(),
                    pendingFees,
                    "should return sum of collected fees and pending fees as both a delegator and transcoder for a round"
                )
            })

            it("should return pending fees for a round before LIP-36", async () => {
                let cumulativeFees = (await bondingManager.getTranscoder(transcoder)).cumulativeFees.toNumber()
                const pendingFees0 = 125 + 750
                const pendingFees1 = Math.floor((250 * (1750 * PERC_DIVISOR / 3000)) / PERC_DIVISOR)
                assert.equal(
                    (await bondingManager.pendingFees(transcoder, currentRound + 1)).toNumber(),
                    pendingFees0 + pendingFees1 + cumulativeFees,
                    "should return sum of collected fees and pending fees as both a delegator and transcoder for a round"
                )
            })
        })
    })
})
