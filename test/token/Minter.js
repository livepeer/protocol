import Fixture from "../helpers/fixture"
import {add, mul} from "../../utils/bn_util"
import expectThrow from "../helpers/expectThrow"

const Minter = artifacts.require("Minter")
const LivepeerToken = artifacts.require("LivepeerToken")

const INITIAL_TOKEN_SUPPLY = mul(10000000, Math.pow(10, 18))
const INITIAL_YEARLY_INFLATION = 26

contract("Minter", accounts => {
    let fixture
    let minter

    const minterBalance = 200

    before(async () => {
        fixture = new Fixture(web3)
        await fixture.deployController()
        await fixture.deployMocks()
        fixture.token = await fixture.deployAndRegister(LivepeerToken, "LivepeerToken")

        minter = await Minter.new(fixture.controller.address, INITIAL_TOKEN_SUPPLY, INITIAL_YEARLY_INFLATION)

        await fixture.token.mint(minter.address, minterBalance)
        await fixture.token.transferOwnership(minter.address)
        await fixture.bondingManager.setMinter(minter.address)
        await fixture.jobsManager.setMinter(minter.address)
        await fixture.roundsManager.setMinter(minter.address)
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("computeRewards", () => {
        it("should throw if sender is not bonding manager", async () => {
            await expectThrow(minter.createReward(10, 100))
        })

        it("should compute rewards when redistributionPool = 0", async () => {
            await fixture.roundsManager.setRoundsPerYear(100)

            // Set up current reward tokens via RoundsManager
            await fixture.roundsManager.callSetCurrentRewardTokens()

            // Set up reward call via BondingManager
            await fixture.bondingManager.setActiveTranscoder(accounts[1], 0, 10, 100)
            await fixture.bondingManager.reward()

            const supply = await minter.initialTokenSupply.call()
            const inflation = await minter.yearlyInflation.call()
            const mintedTokens = supply.mul(inflation).div(100).floor().div(100).floor()
            const expBalance = add(minterBalance, mintedTokens.mul(10).div(100).floor()).toString()

            const balance = await fixture.token.balanceOf(minter.address)
            assert.equal(balance.toString(), expBalance, "minter token balance is incorrect")
        })

        it("should compute rewards and update the redistributionPool when redistributionPool > 0", async () => {
            await fixture.roundsManager.setRoundsPerYear(100)

            // Set up current reward tokens via RoundsManager
            await fixture.bondingManager.callAddToRedistributionPool(100000)
            await fixture.roundsManager.callSetCurrentRewardTokens()

            // Set up reward call via BondingManager
            await fixture.bondingManager.setActiveTranscoder(accounts[1], 0, 10, 100)
            await fixture.bondingManager.reward()

            const supply = await minter.initialTokenSupply.call()
            const inflation = await minter.yearlyInflation.call()
            const mintedTokens = supply.mul(inflation).div(100).floor().div(100).floor()
            const expBalance = add(minterBalance, mintedTokens.mul(10).div(100).floor()).toString()

            const balance = await fixture.token.balanceOf(minter.address)
            assert.equal(balance.toString(), expBalance, "minter token balance is incorrect")

            const redistributedTokens = ((100000 / 100) * 10) / 100
            const expRedistributionPool = 100000 - redistributedTokens

            const redistributionPool = await minter.redistributionPool.call()
            assert.equal(redistributionPool, expRedistributionPool, "redistribution pool incorrect")
        })
    })

    describe("transferTokens", () => {
        it("should throw if sender is not bonding manager or jobs manager", async () => {
            await expectThrow(minter.transferTokens(accounts[1], 100))
        })

        it("should transfer tokens to receiving address when sender is bonding manager", async () => {
            await fixture.bondingManager.setWithdrawAmount(100)
            await fixture.bondingManager.withdraw({from: accounts[1]})

            const balance = await fixture.token.balanceOf(accounts[1])
            assert.equal(balance, 100, "receiving address token balance incorrect")
        })

        it("should transfer tokens to receiving address when sender is jobs manager", async () => {
            await fixture.jobsManager.setWithdrawAmount(100)
            await fixture.jobsManager.withdraw({from: accounts[1]})

            const balance = await fixture.token.balanceOf(accounts[1])
            assert.equal(balance, 100, "receiving address token balance incorrect")
        })
    })
})
