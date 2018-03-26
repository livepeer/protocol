import BigNumber from "bignumber.js"

const TOKEN_UNIT = 10 ** 18

module.exports = {
    initialSupply: new BigNumber(10000000).mul(TOKEN_UNIT),
    // This should always be 0. This field is an artifact of an older
    // design where crowd supply distribution was done during genesis.
    // However, now crowd supply distribution is done post-genesis, so
    // we just keep this field at 0
    crowdSupply: new BigNumber(0),
    companySupply: new BigNumber(7500000).mul(TOKEN_UNIT),
    teamSupply: new BigNumber(1100000).mul(TOKEN_UNIT),
    investorsSupply: new BigNumber(900000).mul(TOKEN_UNIT),
    communitySupply: new BigNumber(500000).mul(TOKEN_UNIT),
    // This value will only be used when deploying to a non-production network
    // i.e. Any network besides mainnet and a test network being used for a dry run
    faucetSupply: new BigNumber(180000).mul(TOKEN_UNIT),
    bankMultisig: "0x0161e041aad467a890839d5b08b138c1e6373072", // Should replace this placeholder address in a real deployment
    governanceMultisig: "0x0161e041aad467a890839d5b08b138c1e6373072", // Should replace this placeholder address in a real deployment
    dummyTokenDistribution: {
        timeToEnd: new BigNumber(60).times(60).times(24).times(7) // 1 week in seconds
    },
    // Should replace these placeholder grants in a real deployment
    teamGrants: [
        {
            receiver: "0xc5065c9eeebe6df2c2284d046bfc906501846c51",
            amount: new BigNumber(1100000).mul(TOKEN_UNIT),
            timeToCliff: new BigNumber(31536000),
            vestingDuration: new BigNumber(126144000)
        }
    ],
    // Should replace these placeholder grants in a real deployment
    investorGrants: [
        {
            receiver: "0x87da6a8c6e9eff15d703fc2773e32f6af8dbe301",
            amount: new BigNumber(900000).mul(TOKEN_UNIT),
            timeToCliff: new BigNumber(31536000),
            vestingDuration: new BigNumber(126144000)
        }
    ],
    // Should replace these placeholder grants in a real deployment
    communityGrants: [
        {
            receiver: "0xb97de4b8c857e4f6bc354f226dc3249aaee49209",
            amount: new BigNumber(500000).mul(TOKEN_UNIT)
        }
    ]
}
