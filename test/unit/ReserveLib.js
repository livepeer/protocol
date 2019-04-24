import Fixture from "./helpers/Fixture"

const PublicReserveLib = artifacts.require("PublicReserveLib")

contract("ReserveLib", () => {
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

    describe("fundsRemaining", () => {
        it("returns difference between reserve.fundsAdded and reserve.fundsClaimed", async () => {
            await lib.fund(10)

            assert.equal((await lib.fundsRemaining()).toString(), "10")
        })
    })
})