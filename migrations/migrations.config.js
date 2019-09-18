import BN from "bn.js"
import {constants} from "../utils/constants"

module.exports = {
    bondingManager: {
        numTranscoders: 20,
        numActiveTranscoders: 10,
        unbondingPeriod: 7,
        maxEarningsClaimsRounds: 20
    },
    broker: {
        // TODO: Consider updating these values prior to deploying to testnet
        unlockPeriod: new BN(40320), // approximately 7 days worth of blocks
        ticketValidityPeriod: new BN(2)
    },
    roundsManager: {
        roundLength: 5760,
        roundLockAmount: 100000
    },
    faucet: {
        requestAmount: (new BN(10)).mul(constants.TOKEN_UNIT),
        requestWait: 1,
        whitelist: []
    },
    minter: {
        inflation: 137,
        inflationChange: 3,
        targetBondingRate: 500000
    },
    verifier: {
        verificationCodeHash: "QmUMk1wF6YmFLFyydhSVgeNCSKk4J8G38DzTzcx6FdYSzV",
        solver: "0xc613674f1876eeb89821bcaa9CfC5B9299BACBF2",
        gasPrice: 20000000000,
        gasLimit: 3000000
    }
}
