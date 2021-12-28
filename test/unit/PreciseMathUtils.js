import runSolidityTest from "./helpers/runSolidityTest"

describe("PreciseMathUtils", () => {
    it("Runs solidity tests", async () => {
        await runSolidityTest("TestPreciseMathUtils", [
            "AssertBool",
            "AssertUint"
        ])
    })
})
