import Fixture from "../helpers/fixture"
import BigNumber from "bignumber.js"
import expectThrow from "../helpers/expectThrow"

const Minter = artifacts.require("Minter")

const PERC_DIVISOR = 1000000
const PERC_MULTIPLIER = PERC_DIVISOR / 100

const INFLATION = 26 * PERC_MULTIPLIER
const INFLATION_CHANGE = .02 * PERC_MULTIPLIER
const TARGET_BONDING_RATE = 50 * PERC_MULTIPLIER

contract("Minter", accounts => {
    let fixture
    let minter

    before(async () => {
        fixture = new Fixture(web3)
        await fixture.deployController()
        await fixture.deployMocks()

        minter = await fixture.deployAndRegister(Minter, "Minter", fixture.controller.address, INFLATION, INFLATION_CHANGE, TARGET_BONDING_RATE)
        fixture.minter = minter

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

    describe("setInflationChange", () => {
        it("should fail if not called by the Controller's owner", async () => {
            await expectThrow(minter.setInflationChange(5, {from: accounts[4]}))
        })

        it("should set the inflation change", async () => {
            await minter.setInflationChange(.1 * PERC_MULTIPLIER)

            const inflationChange = await minter.inflationChange.call()
            assert.equal(inflationChange, .1 * PERC_MULTIPLIER, "wrong inflation change")
        })
    })

    describe("createRewards", () => {
        it("should throw if sender is not bonding manager", async () => {
            await expectThrow(minter.createReward(10, 100))
        })

        it("should compute rewards", async () => {
            await fixture.token.setTotalSupply(1000)
            await fixture.bondingManager.setTotalBonded(200)
            // Set up current reward tokens via RoundsManager
            await fixture.roundsManager.callSetCurrentRewardTokens()

            // Set up reward call via BondingManager
            await fixture.bondingManager.setActiveTranscoder(accounts[1], 0, 10, 100)
            await fixture.bondingManager.reward()

            const supply = await fixture.token.totalSupply.call()
            const inflation = await minter.inflation.call()
            const mintedTokens = supply.mul(inflation).div(PERC_DIVISOR).floor()

            const mintedTo = await fixture.token.mintedTo.call()
            assert.equal(mintedTo, minter.address, "wrong minted to address")
            const minted = await fixture.token.minted.call()
            assert.equal(minted, mintedTokens.mul(10).div(100).floor().toNumber(), "wrong minted amount")
        })

        it("should compute rewards correctly for large fraction = 1", async () => {
            // If we compute the output of createReward as: (mintedTokens * fracNum) / fracDenom where all the values are bigAmount
            // we would overflow when we try to to do mintedTokens * fracNum
            // Instead we compute the output of createReward as: (mintedTokens * ((fracNum * PERC_DIVISOR) / fracDenom)) / PERC_DIVISOR
            // fracNum * PERC_DIVISOR has less of a chance of overflowing since PERC_DIVISOR is bounded in magnitude
            const bigAmount = new BigNumber("10000000000000000000000000000000000000000000000")
            await fixture.token.setTotalSupply(bigAmount)
            await fixture.bondingManager.setTotalBonded(bigAmount)
            // Set up current reward tokens via RoundsManager
            await fixture.roundsManager.callSetCurrentRewardTokens()

            const supply = await fixture.token.totalSupply.call()
            const inflation = await minter.inflation.call()
            const mintedTokens = supply.mul(inflation).div(PERC_DIVISOR).floor()
            const expMinted = mintedTokens.mul(bigAmount.mul(PERC_DIVISOR).div(bigAmount).floor()).div(PERC_DIVISOR).floor()

            // Set up reward call via BondingManager
            await fixture.bondingManager.setActiveTranscoder(accounts[1], 0, bigAmount, bigAmount)
            await fixture.bondingManager.reward()

            let mintedTo = await fixture.token.mintedTo.call()
            assert.equal(mintedTo, minter.address, "wrong minted to address")
            let minted = await fixture.token.minted.call()
            assert.equal(minted.toString(), expMinted.toString(), "wrong minted amount")
        })

        it("should compute rewards correctly for multiple valid calls", async () => {
            await fixture.token.setTotalSupply(1000000)
            await fixture.bondingManager.setTotalBonded(200000)
            // Set up current reward tokens via RoundsManager
            await fixture.roundsManager.callSetCurrentRewardTokens()

            const supply = await fixture.token.totalSupply.call()
            const inflation = await minter.inflation.call()
            const mintedTokens = supply.mul(inflation).div(PERC_DIVISOR).floor()

            // Set up reward call via BondingManager
            await fixture.bondingManager.setActiveTranscoder(accounts[1], 0, 10, 100)
            await fixture.bondingManager.reward()

            let mintedTo = await fixture.token.mintedTo.call()
            assert.equal(mintedTo, minter.address, "wrong minted to address")
            let minted = await fixture.token.minted.call()
            assert.equal(minted, mintedTokens.mul(10).div(100).floor().toNumber(), "wrong minted amount")

            // Set up reward call via BondingManager
            await fixture.bondingManager.setActiveTranscoder(accounts[1], 0, 20, 100)
            await fixture.bondingManager.reward()

            mintedTo = await fixture.token.mintedTo.call()
            assert.equal(mintedTo, minter.address, "wrong minted to address")
            minted = await fixture.token.minted.call()
            assert.equal(minted, mintedTokens.mul(20).div(100).floor().toNumber(), "wrong minted amount")
        })

        it("should throw if all mintable tokens have been minted", async () => {
            await fixture.token.setTotalSupply(1000000)
            await fixture.bondingManager.setTotalBonded(200000)
            // Set up current reward tokens via RoundsManager
            await fixture.roundsManager.callSetCurrentRewardTokens()

            // Set up reward call via BondingManager
            await fixture.bondingManager.setActiveTranscoder(accounts[1], 0, 100, 100)
            await fixture.bondingManager.reward()

            await expectThrow(fixture.bondingManager.reward())
       })
    })

    describe("transferTokens", () => {
        it("should throw if sender is not bonding manager", async () => {
            await expectThrow(minter.transferTokens(accounts[1], 100))
        })

        it("should transfer tokens to receiving address when sender is bonding manager", async () => {
            await fixture.bondingManager.setWithdrawAmount(100)
            await fixture.bondingManager.withdraw(false, accounts[1], {from: accounts[1]})
        })
    })

    describe("withdrawETH", () => {
        it("should throw if sender is not bonding manager or jobs manager", async () => {
            await expectThrow(minter.withdrawETH(accounts[1], 100))
        })

        it("should transfer ETH to receiving address when sender is bonding manager", async () => {
            await fixture.jobsManager.deposit({from: accounts[0], value: 100})
            await fixture.bondingManager.setWithdrawAmount(100)

            const startBalance = web3.eth.getBalance(accounts[1])
            await fixture.bondingManager.withdraw(true, accounts[1], {from: accounts[2]})
            const endBalance = web3.eth.getBalance(accounts[1])

            assert.equal(endBalance.sub(startBalance), 100, "balance did not update correctly")
        })

        it("should transfer ETH to receiving address when sender is jobs manager", async () => {
            await fixture.jobsManager.deposit({from: accounts[0], value: 100})
            await fixture.jobsManager.setWithdrawAmount(100)

            const startBalance = web3.eth.getBalance(accounts[1])
            await fixture.jobsManager.withdraw(true, accounts[1], {from: accounts[2]})
            const endBalance = web3.eth.getBalance(accounts[1])

            assert.equal(endBalance.sub(startBalance).toNumber(), 100, "balance did not update correctly")
        })
    })

    describe("depositETH", () => {
        it("should throw if sender is not jobs manager", async () => {
            await expectThrow(minter.depositETH({from: accounts[1]}))
        })

        it("should receive ETH from the jobs manager", async () => {
            const startBalance = web3.eth.getBalance(minter.address)
            await fixture.jobsManager.deposit({from: accounts[0], value: 100})
            const endBalance = web3.eth.getBalance(minter.address)

            assert.equal(endBalance.sub(startBalance), 100, "minter balance did not update corretly")
        })
    })

    describe("burnTokens", () => {
        it("should throw if sender is not bonding manager", async () => {
            await expectThrow(minter.burnTokens(100, {from: accounts[1]}))
        })

        it("should burn an amount of tokens", async () => {
            await fixture.bondingManager.callBurnTokens(100)

            const burned = await fixture.token.burned.call()
            assert.equal(burned, 100, "wrong burned amount")
        })
    })

    describe("setCurrentRewardTokens", () => {
        it("should throw if sender is not rounds manager", async () => {
            await expectThrow(minter.setCurrentRewardTokens())
        })

        it("should increase the inflation rate if the current bonding rate is below the target bonding rate", async () => {
            await fixture.token.setTotalSupply(1000)
            await fixture.bondingManager.setTotalBonded(400)

            const startInflation = await minter.inflation.call()
            // Call setCurrentRewardTokens via RoundsManager
            await fixture.roundsManager.callSetCurrentRewardTokens()
            const endInflation = await minter.inflation.call()

            assert.equal(endInflation.sub(startInflation).toNumber(), await minter.inflationChange.call(), "inflation rate did not change correctly")
        })

        it("should decrease the inflation rate if the current bonding rate is above the target bonding rate", async () => {
            await fixture.token.setTotalSupply(1000)
            await fixture.bondingManager.setTotalBonded(600)

            const startInflation = await minter.inflation.call()
            // Call setCurrentRewardTokens via RoundsManager
            await fixture.roundsManager.callSetCurrentRewardTokens()
            const endInflation = await minter.inflation.call()

            assert.equal(startInflation.sub(endInflation).toNumber(), await minter.inflationChange.call(), "inflation rate did not change correctly")
        })

        it("should set the inflation rate to 0 if the inflation change is greater than the inflation and the current bonding rate is above the target bonding rate", async () => {
            minter = await fixture.deployAndRegister(Minter, "Minter", fixture.controller.address, INFLATION_CHANGE - 1, INFLATION_CHANGE, TARGET_BONDING_RATE)
            fixture.minter = minter

            await fixture.roundsManager.setMinter(minter.address)

            await fixture.token.setTotalSupply(1000)
            await fixture.bondingManager.setTotalBonded(600)

            // Call setCurrentRewardTokens via RoundsManager
            await fixture.roundsManager.callSetCurrentRewardTokens()
            const endInflation = await minter.inflation.call()

            assert.equal(endInflation, 0, "inflation rate not set to 0")
        })

        it("should maintain the inflation rate if the current bonding rate is equal to the target bonding rate", async () => {
            await fixture.token.setTotalSupply(1000)
            await fixture.bondingManager.setTotalBonded(500)

            const startInflation = await minter.inflation.call()
            // Call setCurrentRewardTokens via RoundsManager
            await fixture.roundsManager.callSetCurrentRewardTokens()
            const endInflation = await minter.inflation.call()

            assert.equal(startInflation.sub(endInflation).toNumber(), 0, "inflation rate did not stay the same")
        })
    })
})
