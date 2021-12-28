import runSolidityTest from "./helpers/runSolidityTest"

describe("SortedDoublyLL", () => {
    it("Runs solidity tests", async () => {
        await runSolidityTest("TestSortedDoublyLLFindWithHints", [
            "SortedDoublyLL",
            "AssertAddress",
            "AssertUint"
        ])
        await runSolidityTest("TestSortedDoublyLLFindWithHints2", [
            "SortedDoublyLL",
            "AssertAddress",
            "AssertUint"
        ])
        await runSolidityTest("TestSortedDoublyLLInsert", [
            "SortedDoublyLL",
            "AssertAddress",
            "AssertUint",
            "AssertBool"
        ])
        await runSolidityTest("TestSortedDoublyLLRemove", [
            "SortedDoublyLL",
            "AssertAddress",
            "AssertUint",
            "AssertBool"
        ])
        await runSolidityTest("TestSortedDoublyLLUpdateKey", [
            "SortedDoublyLL",
            "AssertAddress",
            "AssertUint",
            "AssertBool"
        ])
    })
})
