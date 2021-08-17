module.exports = {
    mocha: {
        timeout: 100000,
    },
    testCommand: "npx hardhat deploy && npx hardhat test",
    skipFiles: [
        "test",
        "rounds/AdjustableRoundsManager.sol",
        "pm/mixins/interfaces",
    ],
};
