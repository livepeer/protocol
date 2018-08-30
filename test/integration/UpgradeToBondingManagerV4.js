import {contractId} from "../../utils/helpers"
import {constants} from "../../utils/constants"
import BigNumber from "bignumber.js"

const Controller = artifacts.require("Controller")
const BondingManager = artifacts.require("BondingManager")
const BondingManagerV3 = artifacts.require("BondingManagerV3")
const SortedDoublyLL = artifacts.require("SortedDoublyLL")
const AdjustableRoundsManager = artifacts.require("AdjustableRoundsManager")
const LivepeerToken = artifacts.require("LivepeerToken")

contract("UpgradeToBondingManagerV4", accounts => {
    let controller
    let bondingManager
    let roundsManager
    let token

    let transcoder1
    let delegator1
    let delegator2
    let delegator3

    let rewardCut
    let feeShare
    let transcoder1StartStake
    let delegator1StartStake
    let delegator2StartStake
    let delegator3StartStake

    let roundLength

    let preUpgradeRounds = []
    let postUpgradeRounds = []

    before(async () => {
        transcoder1 = accounts[0]
        delegator1 = accounts[2]
        delegator2 = accounts[3]
        delegator3 = accounts[4]

        controller = await Controller.deployed()

        // Switch to BondingManagerV3
        BondingManagerV3.link(SortedDoublyLL)
        const bondingManagerTarget = await BondingManagerV3.new(controller.address)
        await controller.setContractInfo(contractId("BondingManagerTarget"), bondingManagerTarget.address, "0x0")

        await controller.unpause()

        const bondingManagerAddr = await controller.getContract(contractId("BondingManager"))
        bondingManager = await BondingManager.at(bondingManagerAddr)

        const roundsManagerAddr = await controller.getContract(contractId("RoundsManager"))
        roundsManager = await AdjustableRoundsManager.at(roundsManagerAddr)

        const tokenAddr = await controller.getContract(contractId("LivepeerToken"))
        token = await LivepeerToken.at(tokenAddr)

        const transferAmount = new BigNumber(10).times(constants.TOKEN_UNIT)
        await token.transfer(transcoder1, transferAmount, {from: accounts[0]})
        await token.transfer(delegator1, transferAmount, {from: accounts[0]})
        await token.transfer(delegator2, transferAmount, {from: accounts[0]})
        await token.transfer(delegator3, transferAmount, {from: accounts[0]})

        roundLength = await roundsManager.roundLength.call()
        await roundsManager.mineBlocks(roundLength.toNumber() * 1000)
        await roundsManager.initializeRound()

        rewardCut = 50 // 50%
        feeShare = 5 // 5%
        transcoder1StartStake = 1000
        delegator1StartStake = 3000
        delegator2StartStake = 3000
        delegator3StartStake = 3000

        // Register transcoder 1
        await token.approve(bondingManager.address, transcoder1StartStake, {from: transcoder1})
        await bondingManager.bond(transcoder1StartStake, transcoder1, {from: transcoder1})
        await bondingManager.transcoder(rewardCut * constants.PERC_MULTIPLIER, feeShare * constants.PERC_MULTIPLIER, 200000000000, {from: transcoder1})

        // Delegator 1 delegates to transcoder 1
        await token.approve(bondingManager.address, delegator1StartStake, {from: delegator1})
        await bondingManager.bond(delegator1StartStake, transcoder1, {from: delegator1})

        // Delegator 2 delegates to transcoder 1
        await token.approve(bondingManager.address, delegator2StartStake, {from: delegator2})
        await bondingManager.bond(delegator2StartStake, transcoder1, {from: delegator2})

        // Delegator 3 delegates to transcoder 1
        await token.approve(bondingManager.address, delegator3StartStake, {from: delegator3})
        await bondingManager.bond(delegator3StartStake, transcoder1, {from: delegator3})

        await roundsManager.mineBlocks(roundLength.toNumber())
        await roundsManager.initializeRound()
    })

    it("upgrades to the new BondingManager after rewards are distributed in past rounds", async () => {
        preUpgradeRounds.push(await roundsManager.currentRound())
        await bondingManager.reward({from: transcoder1})

        await roundsManager.mineBlocks(roundLength)
        await roundsManager.initializeRound()

        preUpgradeRounds.push(await roundsManager.currentRound())
        await bondingManager.reward({from: transcoder1})

        // Switch to new BondingManager
        const bondingManagerTarget = await BondingManager.new(controller.address)
        await controller.setContractInfo(contractId("BondingManagerTarget"), bondingManagerTarget.address, "0x0")

        await roundsManager.mineBlocks(roundLength)
        await roundsManager.initializeRound()

        postUpgradeRounds.push(await roundsManager.currentRound())
        await bondingManager.reward({from: transcoder1})

        await roundsManager.mineBlocks(roundLength)
        await roundsManager.initializeRound()

        postUpgradeRounds.push(await roundsManager.currentRound())
        await bondingManager.reward({from: transcoder1})

        for (let round of preUpgradeRounds) {
            const earningsPool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder1, round)
            assert.equal(earningsPool[6], 0, "transcoder reward pool should be zero")
            assert.isNotOk(earningsPool[8], "hasTranscoderRewardFeePool should be false for pre-upgrade earnings pools")
        }

        for (let round of postUpgradeRounds) {
            const earningsPool = await bondingManager.getTranscoderEarningsPoolForRound(transcoder1, round)
            assert.isAbove(earningsPool[6].toNumber(), 0, "transcoder reward pool should be non-zero")
            assert.isOk(earningsPool[8], "hasTranscoderRewardFeePool should be true for post-upgrade earnings pools")
        }

        const currentRound = await roundsManager.currentRound()
        await bondingManager.claimEarnings(currentRound, {from: delegator1})
        await bondingManager.claimEarnings(currentRound, {from: delegator2})
        await bondingManager.claimEarnings(currentRound, {from: delegator3})
        await bondingManager.claimEarnings(currentRound, {from: transcoder1})
    })
})
