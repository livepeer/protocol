import {HardhatRuntimeEnvironment} from "hardhat/types"
import {DeployFunction} from "hardhat-deploy/types"
import {ethers} from "hardhat"
import {Contract} from "ethers"
import {DeployResult, Export} from "hardhat-deploy/dist/types"
import fs from "fs"

import {
    Controller,
    BondingManager,
    RoundsManager,
    TicketBroker,
    LivepeerToken,
    Governor
} from "../typechain"

import ContractDeployer from "../utils/deployer"
import getNetworkConfig from "./migrations.config"
import genesis from "./genesis.config"

const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero
const MINTER_ROLE = ethers.utils.solidityKeccak256(["string"], ["MINTER_ROLE"])

const PROD_NETWORKS = ["mainnet", "arbitrumMainnet"]

const LIVE_NETWORKS = [
    "mainnet",
    "arbitrumMainnet",
    "rinkeby",
    "rinkebyDevnet",
    "arbitrumRinkeby",
    "arbitrumRinkebyDevnet",
    "gethDev"
]

const ARBITRUM_NETWORKS = [
    "arbitrumMainnet",
    "arbitrumRinkeby",
    "arbitrumRinkebyDevnet"
]

const isProdNetwork = (name: string): boolean => {
    return PROD_NETWORKS.indexOf(name) > -1
}

const isLiveNetwork = (name: string): boolean => {
    return LIVE_NETWORKS.indexOf(name) > -1
}

const isArbitrumNetwork = (name: string): boolean => {
    return ARBITRUM_NETWORKS.indexOf(name) > -1
}

const loadDeploymentExport = (filename: string): Export => {
    return JSON.parse(fs.readFileSync(filename).toString())
}

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
    const {deployments, getNamedAccounts, getChainId} = hre // Get the deployments and getNamedAccounts which are provided by hardhat-deploy
    const {deploy} = deployments // the deployments object itself contains the deploy function

    const {deployer} = await getNamedAccounts() // Fetch named accounts from hardhat.config.ts

    const config = getNetworkConfig(hre.network.name)

    const contractDeployer = new ContractDeployer(deploy, deployer, deployments)

    const Controller: Controller = await contractDeployer.deployController()

    const minter = await contractDeployer.deployAndRegister({
        contract: "Minter",
        name: "Minter",
        args: [
            Controller.address,
            config.minter.inflation,
            config.minter.inflationChange,
            config.minter.targetBondingRate
        ]
    })

    let livepeerToken: Contract | DeployResult
    if (isArbitrumNetwork(hre.network.name)) {
        if (!process.env.LPT_DEPLOYMENT_EXPORT_PATH) {
            throw new Error("LPT_DEPLOYMENT_EXPORT_PATH is not set")
        }

        const deploymentExport = loadDeploymentExport(
            process.env.LPT_DEPLOYMENT_EXPORT_PATH
        )

        if (deploymentExport.chainId !== (await getChainId())) {
            throw new Error("chainId mismatch with LPT deployment export")
        }

        const livepeerTokenAddr =
            deploymentExport.contracts.LivepeerToken.address
        const livepeerTokenABI = deploymentExport.contracts.LivepeerToken.abi

        await contractDeployer.register("LivepeerToken", livepeerTokenAddr)

        livepeerToken = await ethers.getContractAt(
            livepeerTokenABI,
            livepeerTokenAddr
        )

        // The deployer needs to be the admin of LPT
        if (!(await livepeerToken.hasRole(DEFAULT_ADMIN_ROLE, deployer))) {
            throw new Error("deployer is not admin for LPT")
        }
    } else {
        livepeerToken = await contractDeployer.deployAndRegister({
            contract: "LivepeerToken",
            name: "LivepeerToken",
            args: []
        })
    }

    // ticket broker
    const ticketBroker = await contractDeployer.deployAndRegister({
        contract: "TicketBroker",
        name: "TicketBroker",
        proxy: true,
        args: [Controller.address]
    })

    // Register TicketBroker with JobsManager contract ID because in a production system the Minter likely will not be upgraded to be
    // aware of the TicketBroker contract ID and it will only be aware of the JobsManager contract ID
    await contractDeployer.register("JobsManager", ticketBroker.address)

    // bonding manager
    const sortedDoublyLL = await deploy("SortedDoublyLL", {
        from: deployer,
        log: true
    })

    const bondingManager = await contractDeployer.deployAndRegister({
        contract: "BondingManager",
        name: "BondingManager",
        proxy: true,
        libraries: {
            SortedDoublyLL: sortedDoublyLL.address
        },
        args: [Controller.address]
    })

    await contractDeployer.deployAndRegister({
        contract: "BondingVotes",
        name: "BondingVotes",
        proxy: true,
        args: [Controller.address]
    })

    // rounds manager
    let roundsManager
    if (!isLiveNetwork(hre.network.name)) {
        roundsManager = await contractDeployer.deployAndRegister({
            contract: "AdjustableRoundsManager",
            name: "RoundsManager",
            proxy: true,
            args: [Controller.address]
        })
    } else {
        roundsManager = await contractDeployer.deployAndRegister({
            contract: "RoundsManager",
            name: "RoundsManager",
            proxy: true,
            args: [Controller.address]
        })
    }

    // service registry
    await contractDeployer.deployAndRegister({
        contract: "ServiceRegistry",
        name: "ServiceRegistry",
        proxy: true,
        args: [Controller.address]
    })

    // merkle snapshot
    await contractDeployer.deployAndRegister({
        contract: "MerkleSnapshot",
        name: "MerkleSnapshot",
        args: [Controller.address]
    })

    // governor
    const governor = await deploy("Governor", {
        contract: "contracts/governance/Governor.sol:Governor",
        from: deployer,
        args: [],
        log: true
    })

    // Transfer ownership of Governor to governance multisig
    const Governor: Governor = (await ethers.getContractAt(
        "contracts/governance/Governor.sol:Governor",
        governor.address
    )) as Governor

    const transferOwnershipUpdate = {
        target: [governor.address],
        value: ["0"],
        data: [
            Governor.interface.encodeFunctionData("transferOwnership", [
                isProdNetwork(hre.network.name) ?
                    config.governor.owner :
                    deployer
            ])
        ],
        nonce: 0
    }
    await (await Governor.stage(transferOwnershipUpdate, 0)).wait()
    await (await Governor.execute(transferOwnershipUpdate)).wait()

    // Set BondingManager parameters
    const BondingManager: BondingManager = (await ethers.getContractAt(
        "BondingManager",
        bondingManager.address
    )) as BondingManager

    await (
        await BondingManager.setUnbondingPeriod(
            config.bondingManager.unbondingPeriod
        )
    ).wait()
    await (
        await BondingManager.setNumActiveTranscoders(
            config.bondingManager.numActiveTranscoders
        )
    ).wait()

    // Set RoundsManager parameters
    const RoundsManager: RoundsManager = (await ethers.getContractAt(
        "RoundsManager",
        roundsManager.address
    )) as RoundsManager
    await (
        await RoundsManager.setRoundLength(config.roundsManager.roundLength)
    ).wait()
    await (
        await RoundsManager.setRoundLockAmount(
            config.roundsManager.roundLockAmount
        )
    ).wait()

    const currentRound = await RoundsManager.currentRound()
    if (config.roundsManager.lipUpgradeRounds) {
        for (const lipUpgradeRound of config.roundsManager.lipUpgradeRounds) {
            let round = lipUpgradeRound.round
            if (round == 0) {
                round = currentRound
            }
            await (
                await RoundsManager.setLIPUpgradeRound(
                    lipUpgradeRound.lip,
                    round
                )
            ).wait()
        }
    }

    // Set TicketBroker parameters
    const Broker: TicketBroker = (await ethers.getContractAt(
        "TicketBroker",
        ticketBroker.address
    )) as TicketBroker
    await (await Broker.setUnlockPeriod(config.broker.unlockPeriod)).wait()
    await (
        await Broker.setTicketValidityPeriod(config.broker.ticketValidityPeriod)
    ).wait()

    const Token: LivepeerToken = (await ethers.getContractAt(
        "LivepeerToken",
        livepeerToken.address
    )) as LivepeerToken
    if (!isProdNetwork(hre.network.name)) {
        const faucet = await contractDeployer.deployAndRegister({
            contract: "LivepeerTokenFaucet",
            name: "LivepeerTokenFaucet",
            args: [
                livepeerToken.address,
                config.faucet.requestAmount,
                config.faucet.requestWait
            ]
        })
        // If not in production, send the crowd supply to the faucet and the company supply to the deployment account

        await (await Token.grantRole(MINTER_ROLE, deployer)).wait()

        await (await Token.mint(faucet.address, genesis.crowdSupply)).wait()

        await (await Token.mint(deployer, genesis.companySupply)).wait()

        await (await Token.revokeRole(MINTER_ROLE, deployer)).wait()
    }

    await (await Token.grantRole(MINTER_ROLE, minter.address)).wait()

    // Controller is owned by the deployer at this point
    // transferOwnership() needs to be called separately to give ownership to the Governor
}

func.tags = ["Contracts"]
export default func
