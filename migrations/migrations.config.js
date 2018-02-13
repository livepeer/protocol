import BigNumber from "bignumber.js"

const TOKEN_UNIT = 10 ** 18
const PERC_DIVISOR = 1000000
const PERC_MULTIPLIER = PERC_DIVISOR / 100

module.exports = {
    bondingManager: {
        numTranscoders: 10,
        numActiveTranscoders: 5,
        unbondingPeriod: 2,
        maxEarningsClaimsRounds: 20
    },
    jobsManager: {
        verificationRate: 100,
        verificationPeriod: 50,
        verificationSlashingPeriod: 50,
        failedVerificationSlashAmount: 1,
        missedVerificationSlashAmount: .1 * PERC_MULTIPLIER,
        doubleClaimSegmentSlashAmount: 3 * PERC_MULTIPLIER,
        finderFee: 5 * PERC_MULTIPLIER
    },
    roundsManager: {
        roundLength: 50,
        roundLockAmount: 100000
    },
    faucet: {
        requestAmount: new BigNumber(10).mul(TOKEN_UNIT),
        requestWait: 1,
        whitelist: []
    },
    minter: {
        inflation: .0137 * PERC_MULTIPLIER,
        inflationChange: .001 * PERC_MULTIPLIER,
        targetBondingRate: 1.5 * PERC_MULTIPLIER
    },
    verifier: {
        verificationCodeHash: "QmZmvi1BaYSdxM1Tgwhi2mURabh46xCkzuH9PWeAkAZZGc",
        solvers: [],
        gasPrice: 20000000000,
        gasLimit: 3000000
    }
}
