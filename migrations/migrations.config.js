import BigNumber from "bignumber.js"

const TOKEN_UNIT = 10 ** 18
const PERC_DIVISOR = 1000000
const PERC_MULTIPLIER = PERC_DIVISOR / 100

module.exports = {
    bondingManager: {
        numTranscoders: 2,
        numActiveTranscoders: 1,
        unbondingPeriod: 2
    },
    jobsManager: {
        verificationRate: 1,
        verificationPeriod: 50,
        slashingPeriod: 50,
        failedVerificationSlashAmount: 20 * PERC_MULTIPLIER,
        missedVerificationSlashAmount: 30 * PERC_MULTIPLIER,
        doubleClaimSegmentSlashAmount: 40 * PERC_MULTIPLIER,
        finderFee: 4 * PERC_MULTIPLIER
    },
    roundsManager: {
        roundLength: 50
    },
    faucet: {
        faucetAmount: new BigNumber(1000000000000000000000).mul(TOKEN_UNIT),
        requestAmount: new BigNumber(1000000).mul(TOKEN_UNIT),
        requestWait: 2,
        whitelist: []
    },
    minter: {
        inflation: 26 * PERC_MULTIPLIER,
        inflationChange: .02 * PERC_MULTIPLIER,
        targetBondingRate: 50 * PERC_MULTIPLIER
    },
    verifier: {
        verificationCodeHash: "QmZmvi1BaYSdxM1Tgwhi2mURabh46xCkzuH9PWeAkAZZGc",
        solvers: [],
        gasPrice: 20000000000,
        gasLimit: 3000000
    }
}
