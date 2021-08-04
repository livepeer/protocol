// Taken from https://github.com/aragon/aragonOS/blob/ae3b1bde5da14fd5f696d04111d7c5cf57ad7dd1/test/helpers/runSolidityTest.js
import abi from "ethereumjs-abi"
import {ethers} from "hardhat"
import {eventSig} from "../../../utils/helpers"
import {assert} from "chai"
const HOOKS_MAP = {
    beforeAll: "before",
    beforeEach: "beforeEach",
    afterEach: "afterEach",
    afterAll: "afterAll"
}

const processResult = async (txRes, mustAssert) => {
    const receipt = await txRes.wait()
    const eventSignature = eventSig("TestEvent(bool,string)")
    const rawLogs = receipt.logs.filter(log => log.topics[0] === eventSignature)

    // Event defined in the libraries used by contracts/test/helpers/truffle/Assert.sol

    if (mustAssert && !rawLogs.length) {
        throw new Error("No assertions made")
    }

    rawLogs.forEach(log => {
        const result = abi.rawDecode(["bool"], Buffer.from(log.topics[1].slice(2), "hex"))[0]
        const message = abi.rawDecode(["string"], Buffer.from(log.data.slice(2), "hex"))[0]

        if (!result) {
            assert.fail(message)
        } else {
            assert.isOk(result)
        }
    })
}

/**
 * Runs a solidity test file, via javascript.
 * Required to smooth over some technical problems in solidity-coverage
 *
 * @param {string} c Name of Solidity test file
 * @param {Array} libs Array of names of Solidity libraries to link with test file
 * @param {Object} mochaContext Mocha context
 */
async function runSolidityTest(c, libs, mochaContext) {
    const libraries = {}
    for (const libName of libs) {
        libraries[libName] = (await (await ethers.getContractFactory(libName)).deploy()).address
    }

    const artifact = await ethers.getContractFactory(c, {
        libraries: libraries
    })

    const deployed = await artifact.deploy()

    describe(c, () => {
        mochaContext("> Solidity test", async () => {
            const abi = artifact.interface.format()
            for (const iface of abi) {
                const name = iface.split(" ")[1]
                if (["beforeAll()", "beforeEach()", "afterEach()", "afterAll()"].includes(name)) {
                    // Set up hooks
                    global[HOOKS_MAP[name.slice(0, -2)]](async () => {
                        const tx = await deployed[name.slice(0, -2)]()
                        await processResult(tx, false)
                    })
                } else if (name.startsWith("test")) {
                    it(name, async () => {
                        const tx = await deployed[name]()
                        await processResult(tx, false)
                    })
                }
            }
        })
    })
}

// Bind the functions for ease of use, and provide .only() and .skip() hooks
const fn = (c, libs) => runSolidityTest(c, libs, context)
fn.only = (c, libs) => runSolidityTest(c, libs, context.only)
fn.skip = (c, libs) => runSolidityTest(c, libs, context.skip)

module.exports = fn
