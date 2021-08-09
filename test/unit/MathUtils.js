import runSolidityTest from "./helpers/runSolidityTest"

describe("MathUtils", () => {
    it("Runs solidity tests", async () => {
        await runSolidityTest("TestMathUtils", ["AssertBool", "AssertUint"])
    })
})
