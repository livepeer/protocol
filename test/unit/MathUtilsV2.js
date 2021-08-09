import runSolidityTest from "./helpers/runSolidityTest"

describe("MathUtilsV2", () => {
    it("Runs solidity tests", async () => {
        await runSolidityTest("TestMathUtilsV2", ["AssertBool", "AssertUint"])
    })
})
