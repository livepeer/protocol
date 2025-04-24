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
        targetBondingRate: 500000,
        inflationCeiling: 200,
        inflationFloor: 100
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
        targetBondingRate: 500000,
        inflationCeiling: 200,
        inflationFloor: 100
    },
    treasury: {
        minDelay: 0 // 0s initial proposal execution delay
    },
    livepeerGovernor: {
        initialVotingDelay: 1, // 1 round
        initialVotingPeriod: 10, // 10 rounds
        initialProposalThreshold: ethers.utils.parseEther("100"), // 100 LPT
        initialQuorum: 333300, // 33%
        quota: 500000 // 50%
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
        targetBondingRate: 0,
        inflationCeiling: 200,
        inflationFloor: 100
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
        targetBondingRate: 0,
        inflationCeiling: 200,
        inflationFloor: 100
    }
}

const arbitrumRinkebyDevnet = arbitrumRinkeby

const arbitrumMainnet = {
    governor: {
        // Governance multisig
        owner: "0x04F53A0bb244f015cC97731570BeD26F0229da05"
    },
    bondingManager: {
        numActiveTranscoders: 100,
        unbondingPeriod: 7, // 7 rounds
        treasuryRewardCutRate: ethers.BigNumber.from(10).pow(26), // 10% in 27-digit precision
        treasuryBalanceCeiling: ethers.utils.parseEther("750000") // 750k LPT
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
        inflation: 651000, // Current value at round 3766, but is overwritten by `migrateOldMinterState`
        inflationChange: 1000, // Set according to LIP-100
        targetBondingRate: 500000000,
        inflationCeiling: 750000, // Set according to LIP-100
        inflationFloor: 50000 // Set according to LIP-100
    },
    treasury: {
        minDelay: 0 // 0s initial proposal execution delay
    },
    livepeerGovernor: {
        initialVotingDelay: 1, // 1 round
        initialVotingPeriod: 10, // 10 rounds
        initialProposalThreshold: ethers.utils.parseEther("100"), // 100 LPT
        initialQuorum: 333300, // 33%
        quota: 500000 // 50%
    }
}

const networkConfigs: any = {
    rinkeby,
    rinkebyDevnet,
    arbitrumRinkeby,
    arbitrumRinkebyDevnet,
    arbitrumMainnet,
    gethDev
}

export default function getNetworkConfig(network: string) {
    if (!(network in networkConfigs)) {
        return defaultConfig
    }

    return networkConfigs[network]
}
