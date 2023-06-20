import runSolidityTest from "./helpers/runSolidityTest"

runSolidityTest.only(
    "TestSortedArrays",
    ["AssertUint", "AssertBool"],
    undefined,
    true
)
