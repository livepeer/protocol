import {ethers} from "ethers"

const gethDev = {
    bondingManager: {
        numTranscoders: 100,
        numActiveTranscoders: 50,
        unbondingPeriod: 7,
        maxEarningsClaimsRounds: 20
    },
    broker: {
        unlockPeriod: 50,
        ticketValidityPeriod: ethers.BigNumber.from(2)
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
        targetBondingRate: 500000
    }
}

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
    },
    treasury: {
        minDelay: 0 // 0s initial proposal delay
    },
    livepeerGovernor: {
        initialVotingDelay: 1, // 1 round
        initialVotingPeriod: 10, // 10 rounds
        initialProposalThreshold: ethers.utils.parseEther("100") // 100 LPT
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

const arbitrumGoerliDevnet = {
    ...arbitrumRinkeby,
    roundsManager: {
        roundLength: 360,
        roundLockAmount: 100000
    },
    treasury: {
        minDelay: 0 // 0s initial proposal delay
    },
    livepeerGovernor: {
        initialVotingDelay: 1, // 1 round
        initialVotingPeriod: 10, // 10 rounds
        initialProposalThreshold: ethers.utils.parseEther("100") // 100 LPT
    }
}

const arbitrumMainnet = {
    governor: {
        // Governance multisig
        owner: "0x04F53A0bb244f015cC97731570BeD26F0229da05"
    },
    bondingManager: {
        numActiveTranscoders: 100,
        // Rounds
        unbondingPeriod: 7
    },
    broker: {
        // Rounds
        unlockPeriod: 2,
        // Rounds
        ticketValidityPeriod: 2
    },
    roundsManager: {
        roundLength: 5760,
        roundLockAmount: 100000
    },
    minter: {
        // As of L1 round 2460 inflation was 221500 and bonding rate > 50% so inflation was declining
        // The switch to L2 projected to occur in L1 round 2466
        // If inflation continues to decrease inflation projected to be 221500 - (6 * 500) = 218500 in L1 round 2466
        // No reward calls will happen on L2 until the round after migrations start since it takes a round for orchestrators to become active
        // The inflation at the start of that round will be 218500 - 500 = 218000
        inflation: 218500,
        inflationChange: 500,
        targetBondingRate: 500000000
    }
}

const networkConfigs: any = {
    rinkeby,
    rinkebyDevnet,
    arbitrumRinkeby,
    arbitrumRinkebyDevnet,
    arbitrumGoerliDevnet,
    arbitrumMainnet,
    gethDev
}

export default function getNetworkConfig(network: string) {
    if (!(network in networkConfigs)) {
        return defaultConfig
    }

    return networkConfigs[network]
}
