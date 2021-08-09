import runSolidityTest from "./helpers/runSolidityTest"

describe("EarningsPool", () => {
    it("Runs solidity tests", async () => {
        await runSolidityTest("TestEarningsPool", ["AssertUint"])
        await runSolidityTest("TestEarningsPool2", ["AssertUint", "AssertBool"])
        await runSolidityTest("TestEarningsPoolNoTranscoderRewardFeePool", ["AssertUint", "AssertBool"])
        await runSolidityTest("TestEarningsPoolLIP36", ["AssertUint"])
    })
})
