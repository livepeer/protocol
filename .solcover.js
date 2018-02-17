const glob = require("glob")

const testFiles = glob.sync("contracts/test/*.sol").map(file => file.replace("contracts/", ""))
const mockFiles = ["verification/IdentityVerifier.sol", "rounds/AdjustableRoundsManager.sol"]
const interfaces = [
    "IController.sol",
    "IManager.sol",
    "bonding/IBondingManager.sol",
    "jobs/IJobsManager.sol",
    "rounds/IRoundsManager.sol",
    "token/ILivepeerToken.sol",
    "token/IMinter.sol",
    "token/ITokenDistribution.sol",
    "verification/IVerifiable.sol",
    "verification/IVerifier.sol"
]

module.exports = {
    norpc: true,
    testCommand: "node --max-old-space-size=4096 ../node_modules/.bin/truffle test test/unit/* --network coverage",
    compileCommand: "node --max-old-space-size=4096 ../node_modules/.bin/truffle compile --network coverage",
    copyPackages: ["zeppelin-solidity"],
    skipFiles: testFiles.concat(mockFiles).concat(interfaces)
}
