module.exports = {
    mocha: {
        timeout: 100000,
    },
    testCommand: "npx hardhat deploy && npx hardhat test",
    skipFiles: [
        "test",
        "zeppelin",
        "rounds/AdjustableRoundsManager.sol",
        "pm/mixins/interfaces",
        "bonding/deprecated",
        "token/LivepeerToken.sol", // https://github.com/livepeer/arbitrum-lpt-bridge/blob/main/test/unit/L2/livepeerToken.test.ts
        "token/ArbitrumLivepeerToken.sol", // testnet only,
        "arbitrum",
    ],
};
