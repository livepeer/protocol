import BigNumber from "bignumber.js"

const TOKEN_UNIT = 10 ** 18

module.exports = {
    bondingManager: {
        numActiveTranscoders: 1,
        unbondingPeriod: 2
    },
    jobsManager: {
        verificationRate: 1,
        verificationPeriod: 50,
        slashingPeriod: 50,
        failedVerificationSlashAmount: 20,
        missedVerificationSlashAmount: 30,
        finderFee: 4
    },
    roundsManager: {
        blockTime: 1,
        roundLength: 50
    },
    faucet: {
        faucetAmount: new BigNumber(1000000000000000000000).mul(TOKEN_UNIT),
        requestAmount: new BigNumber(1000000).mul(TOKEN_UNIT),
        requestWait: 2,
        whitelist: []
    },
    minter: {
        initialTokenSupply: 10000000 * Math.pow(10, 18),
        yearlyInflation: 26
    },
    verifier: {
        verificationCodeHash: "QmZmvi1BaYSdxM1Tgwhi2mURabh46xCkzuH9PWeAkAZZGc",
        solvers: [],
        gasPrice: 20000000000,
        gasLimit: 3000000
    }
}
