import BN from "bn.js"

const TicketBroker = artifacts.require("TicketBroker")

contract("TicketBroker", accounts => {
    let broker

    before(async () => {
        broker = await TicketBroker.new()
    })

    describe("fundDeposit", () => {
        it("grows the broker ETH balance", async () => {
            await broker.fundDeposit({from: accounts[0], value: 1000})

            const balance = await web3.eth.getBalance(broker.address)

            assert.equal(balance, "1000")
        })

        it("reduces the sender's ETH balance", async () => {
            const startBalance = new BN(await web3.eth.getBalance(accounts[0]))
            const txRes = await broker.fundDeposit({from: accounts[0], value: 1000})
            const endBalance = new BN(await web3.eth.getBalance(accounts[0]))

            const tx = await web3.eth.getTransaction(txRes.tx)
            const gasPrice = new BN(tx.gasPrice)
            const gasUsed = new BN(txRes.receipt.gasUsed)
            const txCost = gasPrice.mul(gasUsed)

            assert.equal(startBalance.sub(endBalance).sub(txCost).toString(), "1000")
        })
    })
})
