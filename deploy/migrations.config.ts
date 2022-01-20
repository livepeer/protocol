import {ethers} from "hardhat"

const defaultConfig = {
    bondingManager: {
        numTranscoders: 20,
        numActiveTranscoders: 10,
        unbondingPeriod: 7,
        maxEarningsClaimsRounds: 20
    },
    broker: {
        // TODO: Consider updating these values prior to deploying to testnet
        unlockPeriod: ethers.BigNumber.from(40320), // approximately 7 days worth of blocks
        ticketValidityPeriod: ethers.BigNumber.from(2)
    },
    roundsManager: {
        roundLength: 5760,
        roundLockAmount: 100000
    },
    faucet: {
        requestAmount: ethers.utils.parseEther("10"),
        requestWait: 1,
        whitelist: []
    },
    minter: {
        inflation: 137,
        inflationChange: 3,
        targetBondingRate: 500000
    }
}

const rinkeby = {
    arbitrumLivepeerToken: {
        router: "0x70C143928eCfFaf9F5b406f7f4fC28Dc43d68380"
    },
    bondingManager: {
        numActiveTranscoders: 100,
        unbondingPeriod: 2
    },
    broker: {
        unlockPeriod: 100,
        ticketValidityPeriod: 2
    },
    roundsManager: {
        roundLength: 50,
        roundLockAmount: 100000,
        lipUpgradeRounds: [
            {
                lip: 36,
                round: 0
            },
            {
                lip: 71,
                round: 0
            }
        ]
    },
    faucet: {
        requestAmount: ethers.utils.parseEther("10"),
        requestWait: 1,
        whitelist: []
    },
    minter: {
        inflation: 137,
        inflationChange: 3,
        targetBondingRate: 0
    }
}

const rinkebyDevnet = rinkeby

const arbitrumRinkeby = {
    bondingManager: {
        numActiveTranscoders: 100,
        unbondingPeriod: 2
    },
    broker: {
        unlockPeriod: 100,
        ticketValidityPeriod: 2
    },
    roundsManager: {
        roundLength: 50,
        roundLockAmount: 100000
    },
    faucet: {
        requestAmount: ethers.utils.parseEther("10"),
        requestWait: 1,
        whitelist: []
    },
    minter: {
        inflation: 137,
        inflationChange: 3,
        targetBondingRate: 0
    }
}

const arbitrumRinkebyDevnet = arbitrumRinkeby

const networkConfigs: any = {
    rinkeby,
    rinkebyDevnet,
    arbitrumRinkeby,
    arbitrumRinkebyDevnet
}

export default function getNetworkConfig(network: string) {
    if (!(network in networkConfigs)) {
        return defaultConfig
    }

    return networkConfigs[network]
}
