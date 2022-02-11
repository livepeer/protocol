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
    },
    bridgeMinter: {
        controller: "0x9a9827455911a858E55f07911904fACC0D66027E",
        // TODO: Fill in once deployed
        l1Migrator: "0x",
        // TODO: Fill in once deployed
        l1LPTGateway: "0x"
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

const mainnet = {
    bridgeMinter: {
        controller: "0xf96d54e490317c557a967abfa5d6e33006be69b3",
        l1Migrator: "0xC3ee6a18ACB2975E873fe106cB0E7132145616De",
        l1LPTGateway: "0xD82c27966eBB293b2D8646D8eAcb293BC260698E"
    }
}

const networkConfigs: any = {
    rinkeby,
    rinkebyDevnet,
    arbitrumRinkeby,
    mainnet
}

export default function getNetworkConfig(network: string) {
    if (!(network in networkConfigs)) {
        return defaultConfig
    }

    return networkConfigs[network]
}
