// Taken from https://github.com/aragon/aragonOS/blob/ae3b1bde5da14fd5f696d04111d7c5cf57ad7dd1/test/helpers/runSolidityTest.js
const abi = require("ethereumjs-abi")
const {eventSig} = require("../../../utils/helpers")

const HOOKS_MAP = {
    beforeAll: "before",
    beforeEach: "beforeEach",
    afterEach: "afterEach",
    afterAll: "afterAll"
}

const processResult = (txRes, mustAssert) => {
    if (!txRes || !txRes.receipt) {
        return
    }

    // Event defined in the libraries used by contracts/test/helpers/truffle/Assert.sol
    const eventSignature = eventSig("TestEvent(bool,string)")
    const rawLogs = txRes.receipt.rawLogs.filter(log => log.topics[0] === eventSignature)

    if (mustAssert && !rawLogs.length) {
        throw new Error("No assertions made")
    }

    rawLogs.forEach(log => {
        const result = abi.rawDecode(["bool"], Buffer.from(log.topics[1].slice(2), "hex"))[0]
        const message = abi.rawDecode(["string"], Buffer.from(log.data.slice(2), "hex"))[0]

        if (!result) {
            throw new Error(message)
        }
    })
}

/**
 * Deploy and link `libName` to provided contract artifact.
 * Modifies bytecode in place
 *
 * @param {string} contract Contract name
 * @param {string} libName Library name
*/
const linkLib = async (contract, libName) => {
    const underscores = n => "_".repeat(n)
    const PREFIX_UNDERSCORES = 2
    const ADDR_LENGTH = 40

    const prefix = underscores(PREFIX_UNDERSCORES)
    const suffix = underscores(ADDR_LENGTH - PREFIX_UNDERSCORES - libName.length)
    const libPlaceholder = `${prefix}${libName}${suffix}`

    const lib = await artifacts.require(libName).new()
    const libAddr = lib.address.replace("0x", "").toLowerCase()

    contract.bytecode = contract.bytecode.replace(new RegExp(libPlaceholder, "g"), libAddr)
}

/**
 * Runs a solidity test file, via javascript.
 * Required to smooth over some technical problems in solidity-coverage
 *
 * @param {string} c Name of Solidity test file
 * @param {Array} libs Array of names of Solidity libraries to link with test file
 * @param {Object} mochaContext Mocha context
*/
function runSolidityTest(c, libs, mochaContext) {
    const artifact = artifacts.require(c)
    contract(c, () => {
        let deployed

        before(async () => {
            await linkLib(artifact, "Assert")
            await linkLib(artifact, "AssertAddress")
            await linkLib(artifact, "AssertAddressArray")
            await linkLib(artifact, "AssertBalance")
            await linkLib(artifact, "AssertBool")
            await linkLib(artifact, "AssertBytes32")
            await linkLib(artifact, "AssertBytes32Array")
            await linkLib(artifact, "AssertGeneral")
            await linkLib(artifact, "AssertInt")
            await linkLib(artifact, "AssertIntArray")
            await linkLib(artifact, "AssertIntArray")
            await linkLib(artifact, "AssertString")
            await linkLib(artifact, "AssertUint")
            await linkLib(artifact, "AssertUintArray")

            if (libs) {
                for (let lib of libs) {
                    await linkLib(artifact, lib)
                }
            }

            deployed = await artifact.new()
        })

        mochaContext("> Solidity test", () => {
            artifact.abi.forEach(iface => {
                if (iface.type === "function") {
                    if (["beforeAll", "beforeEach", "afterEach", "afterAll"].includes(iface.name)) {
                        // Set up hooks
                        global[HOOKS_MAP[iface.name]](() => {
                            return deployed[iface.name]().then(txRes => processResult(txRes, false))
                        })
                    } else if (iface.name.startsWith("test")) {
                        it(iface.name, () => {
                            return deployed[iface.name]().then(txRes => processResult(txRes, true))
                        })
                    }
                }
            })
        })
    })
}

// Bind the functions for ease of use, and provide .only() and .skip() hooks
const fn = (c, libs) => runSolidityTest(c, libs, context)
fn.only = (c, libs) => runSolidityTest(c, libs, context.only)
fn.skip = (c, libs) => runSolidityTest(c, libs, context.skip)

module.exports = fn
