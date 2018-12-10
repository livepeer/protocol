module.exports = {
    norpc: true,
    testCommand: "node --max-old-space-size=4096 ../node_modules/.bin/truffle test --network coverage",
    compileCommand: "node --max-old-space-size=4096 ../node_modules/.bin/truffle compile --network coverage",
    copyPackages: ["openzeppelin-solidity"],
    skipFiles: ["test", "zeppelin", "rounds/AdjustableRoundsManager.sol", "pm/ERC20TicketBroker.sol"]
}
