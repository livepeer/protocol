import Fixture from "./helpers/Fixture"
import truffleAssert from "truffle-assertions"
import BN from "bn.js"

const PublicReserveLib = artifacts.require("PublicReserveLib")

contract("ReserveLib", accounts => {
    let fixture
    let lib

    before(async () => {
        fixture = new Fixture(web3)
        lib = await PublicReserveLib.new()
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("fund", () => {
        it("increases reserve.fundsAdded", async () => {
            const amount = 10

            await lib.fund(amount)

            assert.equal((await lib.getReserve()).fundsAdded.toString(), amount.toString())
        })

        it("increases reserve.fundsAdded multiple times", async () => {
            const amount = 10
            const amount2 = 20

            await lib.fund(amount)
            await lib.fund(amount2)

            assert.equal((await lib.getReserve()).fundsAdded.toString(), (amount + amount2).toString())
        })
    })

    describe("clear", () => {
        it("deletes current reserve", async () => {
            await lib.fund(10)

            await lib.clear()

            const reserve = await lib.getReserve()
            assert.equal(reserve.fundsAdded.toString(), "0")
            assert.equal(reserve.fundsClaimed.toString(), "0")
            assert.equal(reserve.freezeRound.toString(), "0")
            assert.equal(reserve.recipientsInFreezeRound.toString(), "0")
        })

        it("increments reserveNonce when reserveNonce = 0", async () => {
            const startNonce = await lib.getReserveNonce()

            await lib.clear()

            const endNonce = await lib.getReserveNonce()

            assert.equal(endNonce.toString(), "1")
            assert.equal(endNonce.sub(startNonce).toString(), "1")
        })

        it("increments reserveNonce when reserveNonce > 0", async () => {
            await lib.clear()

            const startNonce = await lib.getReserveNonce()

            await lib.clear()

            const endNonce = await lib.getReserveNonce()

            assert.equal(endNonce.toString(), "2")
            assert.equal(endNonce.sub(startNonce).toString(), "1")
        })
    })

    describe("freeze", () => {
        it("sets reserve.freezeRound and reserve.recipientsInFreezeRound", async () => {
            const freezeRound = 5
            const recipientsInFreezeRound = 10

            await lib.freeze(freezeRound, recipientsInFreezeRound)

            const reserve = await lib.getReserve()
            assert.equal(reserve.freezeRound.toString(), freezeRound.toString())
            assert.equal(reserve.recipientsInFreezeRound.toString(), recipientsInFreezeRound.toString())
        })
    })

    describe("claim", () => {
        it("returns 0 and does not execute state updates when reserve.freezeRound = 0", async () => {
            const claimant = accounts[0]

            await lib.fund(10)
            await lib.freeze(0, 5)

            const txRes = await lib.claim(claimant, 10)

            truffleAssert.eventEmitted(txRes, "Claimed", ev => {
                return ev.amount.toString() === "0"
            })

            const reserve = await lib.getReserve()
            assert.equal(reserve.fundsAdded.toString(), "10")
            assert.equal(reserve.fundsClaimed.toString(), "0")
            assert.equal(reserve.freezeRound.toString(), "0")
            assert.equal(reserve.recipientsInFreezeRound.toString(), "5")
        })

        it("returns 0 and does not execute state updates when reserve.recipientsInFreezeRound = 0", async () => {
            const claimant = accounts[0]

            await lib.fund(10)
            await lib.freeze(5, 0)

            const txRes = await lib.claim(claimant, 10)

            truffleAssert.eventEmitted(txRes, "Claimed", ev => {
                return ev.amount.toString() === "0"
            })

            const reserve = await lib.getReserve()
            assert.equal(reserve.fundsAdded.toString(), "10")
            assert.equal(reserve.fundsClaimed.toString(), "0")
            assert.equal(reserve.freezeRound.toString(), "5")
            assert.equal(reserve.recipientsInFreezeRound.toString(), "0")
        })

        describe("amount owed to claimant > amount claimable by claimant", () => {
            it("updates amount claimed by claimant to max allocation", async () => {
                const claimant = accounts[0]
                const reserve = 100
                const recipientsInFreezeRound = 10
                const allocation = reserve / recipientsInFreezeRound

                await lib.fund(reserve)
                await lib.freeze(5, recipientsInFreezeRound)

                await lib.claim(claimant, allocation + 5)

                assert.equal((await lib.claimed(claimant)).toString(), allocation.toString())
            })

            describe("amount claimable by claimant = max allocation", () => {
                it("increases reserve.fundsClaimed by max allocation", async () => {
                    const claimant = accounts[0]
                    const reserve = 100
                    const recipientsInFreezeRound = 10
                    const allocation = reserve / recipientsInFreezeRound
                    const startReserveFundsClaimed = new BN((await lib.getReserve()).fundsClaimed)

                    await lib.fund(reserve)
                    await lib.freeze(5, recipientsInFreezeRound)

                    await lib.claim(claimant, allocation + 5)

                    const endReserveFundsClaimed = new BN((await lib.getReserve()).fundsClaimed)
                    assert.equal(endReserveFundsClaimed.sub(startReserveFundsClaimed).toString(), allocation.toString())
                })

                it("returns max allocation", async () => {
                    const claimant = accounts[0]
                    const reserve = 100
                    const recipientsInFreezeRound = 10
                    const allocation = reserve / recipientsInFreezeRound

                    await lib.fund(reserve)
                    await lib.freeze(5, recipientsInFreezeRound)

                    const txRes = await lib.claim(claimant, allocation + 5)

                    truffleAssert.eventEmitted(txRes, "Claimed", ev => {
                        return ev.amount.toString() === allocation.toString()
                    })
                })
            })

            describe("amount claimable by claimant < max allocation", () => {
                it("increases reserve.fundsClaimed by amount claimable by claimant", async () => {
                    const claimant = accounts[0]
                    const reserve = 100
                    const recipientsInFreezeRound = 10
                    const allocation = reserve / recipientsInFreezeRound

                    await lib.fund(reserve)
                    await lib.freeze(5, recipientsInFreezeRound)
                    await lib.claim(claimant, allocation - 5)

                    const startReserveFundsClaimed = new BN((await lib.getReserve()).fundsClaimed)

                    await lib.claim(claimant, 5)

                    const endReserveFundsClaimed = new BN((await lib.getReserve()).fundsClaimed)
                    assert.equal(endReserveFundsClaimed.sub(startReserveFundsClaimed).toString(), "5")
                })

                it("returns amount claimable by claimant", async () => {
                    const claimant = accounts[0]
                    const reserve = 100
                    const recipientsInFreezeRound = 10
                    const allocation = reserve / recipientsInFreezeRound

                    await lib.fund(reserve)
                    await lib.freeze(5, recipientsInFreezeRound)
                    await lib.claim(claimant, allocation - 5)

                    const txRes = await lib.claim(claimant, 5)

                    truffleAssert.eventEmitted(txRes, "Claimed", ev => {
                        return ev.amount.toString() === "5"
                    })
                })
            })
        })

        describe("amount owed to claimant <= amount claimable by claimant", () => {
            it("increases amount claimed by claimant by amount owed to claimant", async () => {
                const claimant = accounts[0]
                const reserve = 100
                const recipientsInFreezeRound = 10
                const allocation = reserve / recipientsInFreezeRound
                const claimAmount = allocation - 5

                await lib.fund(reserve)
                await lib.freeze(5, recipientsInFreezeRound)

                await lib.claim(claimant, claimAmount)

                assert.equal((await lib.claimed(claimant)).toString(), claimAmount.toString())
            })

            it("increases reserve.fundsClaimed by amount owed to claimant", async () => {
                const claimant = accounts[0]
                const reserve = 100
                const recipientsInFreezeRound = 10
                const allocation = reserve / recipientsInFreezeRound
                const claimAmount = allocation - 5
                const startReserveFundsClaimed = new BN((await lib.getReserve()).fundsClaimed)

                await lib.fund(reserve)
                await lib.freeze(5, recipientsInFreezeRound)

                await lib.claim(claimant, claimAmount)

                const endReserveFundsClaimed = new BN((await lib.getReserve()).fundsClaimed)
                assert.equal(endReserveFundsClaimed.sub(startReserveFundsClaimed).toString(), claimAmount.toString())
            })

            it("returns amount owed to claimant", async () => {
                const claimant = accounts[0]
                const reserve = 100
                const recipientsInFreezeRound = 10
                const allocation = reserve / recipientsInFreezeRound
                const claimAmount = allocation - 5

                await lib.fund(reserve)
                await lib.freeze(5, recipientsInFreezeRound)

                const txRes = await lib.claim(claimant, claimAmount)

                truffleAssert.eventEmitted(txRes, "Claimed", ev => {
                    return ev.amount.toString() === claimAmount.toString()
                })
            })
        })

        it("tracks claimant's multiple claims", async () => {
            const claimant = accounts[0]
            const claimAmount = 1

            await lib.fund(100)
            await lib.freeze(5, 10)

            await lib.claim(claimant, claimAmount)
            await lib.claim(claimant, claimAmount)
            await lib.claim(claimant, claimAmount)

            const reserve = await lib.getReserve()
            assert.equal(reserve.fundsClaimed.toString(), (claimAmount * 3).toString())
            assert.equal((await lib.claimed(claimant)).toString(), (claimAmount * 3).toString())
        })

        it("tracks multiple claimants' claims", async () => {
            const claimant = accounts[0]
            const claimant2 = accounts[1]
            const claimAmount = 1
            const claimAmount2 = 2

            await lib.fund(100)
            await lib.freeze(5, 10)

            await lib.claim(claimant, claimAmount)
            await lib.claim(claimant2, claimAmount2)

            const reserve = await lib.getReserve()
            assert.equal(reserve.fundsClaimed.toString(), (claimAmount + claimAmount2).toString())
            assert.equal((await lib.claimed(claimant)).toString(), claimAmount.toString())
            assert.equal((await lib.claimed(claimant2)).toString(), claimAmount2.toString())
        })
    })

    describe("fundsRemaining", () => {
        it("returns difference between reserve.fundsAdded and reserve.fundsClaimed", async () => {
            await lib.fund(10)

            assert.equal((await lib.fundsRemaining()).toString(), "10")
        })
    })

    describe("isFrozen", () => {
        it("returns true when reserve.freezeRound > 0", async () => {
            await lib.freeze(1, 0)

            assert(await lib.isFrozen())
        })

        it("returns false when reserve.freezeRound = 0", async () => {
            assert(!(await lib.isFrozen()))
        })
    })
})
