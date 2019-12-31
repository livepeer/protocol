import BN from "bn.js"
import Fixture from "./helpers/Fixture"
import expectRevertWithReason from "../helpers/expectFail"
import truffleAssert from "truffle-assertions"

const Refunder = artifacts.require("Refunder")
const AlphaJobsManagerMock = artifacts.require("AlphaJobsManagerMock")

contract("Refunder", accounts => {
    let fixture

    let refunder
    let jobsManager

    before(async () => {
        fixture = new Fixture(web3)

        jobsManager = await AlphaJobsManagerMock.new()
        refunder = await Refunder.new(jobsManager.address)
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => [
        await fixture.tearDown()
    ])

    describe("constructor", () => {
        it("sets alpha JobsManager", async () => {
            assert.equal(await refunder.alphaJobsManager.call(), jobsManager.address)
        })
    })

    describe("fallback", () => {
        it("receives ETH", async () => {
            const txRes = await refunder.sendTransaction({from: accounts[0], value: 1000})
            truffleAssert.eventEmitted(
                await truffleAssert.createTransactionResult(refunder, txRes.tx),
                "FundsReceived",
                ev => ev.from === accounts[0] && ev.amount.toString() === "1000"
            )

            assert.equal((await web3.eth.getBalance(refunder.address)).toString(), "1000")
        })
    })

    describe("withdraw", () => {
        it("should revert if address does not have a deposit with alpha JobsManager", async () => {
            await expectRevertWithReason(
                refunder.withdraw(accounts[1]),
                "address does not have a deposit with alpha JobsManager"
            )
        })

        it("should send refund to address", async () => {
            const addr1 = accounts[1]
            const addr2 = accounts[2]

            // Make sure that addresses have not withdrawn
            assert.isNotOk(await refunder.withdrawn(addr1))
            assert.isNotOk(await refunder.withdrawn(addr2))

            // Send funds to refunder
            await refunder.sendTransaction({from: accounts[0], value: 1000})

            await jobsManager.setBroadcaster(addr1, 700, 99)
            await jobsManager.setBroadcaster(addr2, 300, 99)

            let startRefunderBalance = new BN(await web3.eth.getBalance(refunder.address))
            const startAddr1Balance = new BN(await web3.eth.getBalance(addr1))

            let txRes = await refunder.withdraw(addr1)
            truffleAssert.eventEmitted(txRes, "RefundWithdrawn", ev => {
                return ev.addr === addr1 && ev.amount.toString() === "700"
            })

            let endRefunderBalance = new BN(await web3.eth.getBalance(refunder.address))
            const endAddr1Balance = new BN(await web3.eth.getBalance(addr1))

            assert.equal(startRefunderBalance.sub(endRefunderBalance).toString(), "700")
            assert.equal(endAddr1Balance.sub(startAddr1Balance).toString(), "700")
            assert.isOk(await refunder.withdrawn(addr1))

            startRefunderBalance = endRefunderBalance
            const startAddr2Balance = new BN(await web3.eth.getBalance(addr2))

            txRes = await refunder.withdraw(addr2)
            truffleAssert.eventEmitted(txRes, "RefundWithdrawn", ev => {
                return ev.addr === addr2 && ev.amount.toString() === "300"
            })

            endRefunderBalance = new BN(await web3.eth.getBalance(refunder.address))
            const endAddr2Balance = new BN(await web3.eth.getBalance(addr2))

            assert.equal(startRefunderBalance.sub(endRefunderBalance).toString(), "300")
            assert.equal(endAddr2Balance.sub(startAddr2Balance).toString(), "300")
            assert.isOk(await refunder.withdrawn(addr2))
        })

        it("should revert if address has withdrawn", async () => {
            const addr1 = accounts[1]

            // Send funds to refunder
            await refunder.sendTransaction({from: accounts[0], value: 1000})

            await jobsManager.setBroadcaster(addr1, 700, 99)

            await refunder.withdraw(addr1)

            await expectRevertWithReason(
                refunder.withdraw(addr1),
                "address has already withdrawn alpha JobsManager refund"
            )
        })
    })
})
