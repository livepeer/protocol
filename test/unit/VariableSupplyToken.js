import expectThrow from "../helpers/expectThrow"

const VariableSupplyToken = artifacts.require("VariableSupplyToken")

contract("VariableSupplyToken", accounts => {
    let token

    before(async () => {
        token = await VariableSupplyToken.new()
    })

    describe("burn", () => {
        it("should reduce the supply and balance of the sender", async () => {
            await token.mint(accounts[0], 500, {from: accounts[0]})

            await token.burn(200, {from: accounts[0]})

            const balance = await token.balanceOf(accounts[0])
            assert.equal(balance, 300, "wrong balance")
            const totalSupply = await token.totalSupply.call()
            assert.equal(totalSupply, 300, "wrong total supply")
        })

        it("should throw if burn amount is greater than sender balance", async () => {
            await expectThrow(token.burn(400, {from: accounts[0]}))
        })
    })
})
