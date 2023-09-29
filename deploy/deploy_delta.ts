import {HardhatRuntimeEnvironment} from "hardhat/types"
import {DeployFunction} from "hardhat-deploy/types"

import ContractDeployer from "../utils/deployer"
import {ethers} from "hardhat"
import {BondingManager, LivepeerGovernor, Treasury} from "../typechain"
import getNetworkConfig from "./migrations.config"
import {contractId} from "../utils/helpers"

const PROD_NETWORKS = ["mainnet", "arbitrumMainnet"]

const isProdNetwork = (name: string): boolean => {
    return PROD_NETWORKS.indexOf(name) > -1
}

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
    const {deployments, getNamedAccounts} = hre // Get the deployments and getNamedAccounts which are provided by hardhat-deploy
    const {deploy} = deployments // the deployments object itself contains the deploy function

    const config = getNetworkConfig(hre.network.name)

    const {deployer} = await getNamedAccounts() // Fetch named accounts from hardhat.config.ts

    // on prod networks, deploy contracts here but registration is done later through governance
    // on test networks, the deployer must also be the controller owner so we can register here
    const skipRegister = isProdNetwork(hre.network.name)
    const contractDeployer = new ContractDeployer(
        deploy,
        deployer,
        deployments,
        skipRegister
    )
    const controller = await contractDeployer.fetchDeployedController()

    const llDeployment = await deployments.get("SortedDoublyLL")

    await contractDeployer.deployAndRegister({
        contract: "BondingManager",
        name: "BondingManagerTarget",
        libraries: {
            SortedDoublyLL: llDeployment.address
        },
        args: [controller.address],
        proxy: false // we're deploying the Target directly, so proxy is false
    })

    await contractDeployer.deployAndRegister({
        contract: "BondingVotes",
        name: "BondingVotes",
        args: [controller.address],
        proxy: true
    })

    const treasury = await contractDeployer.deployAndRegister({
        contract: "Treasury",
        name: "Treasury",
        args: [],
        proxy: false
    })
    const Treasury: Treasury = await ethers.getContractAt(
        "Treasury",
        treasury.address
    )

    // We should already initialize the treasury since it's not a proxy
    await Treasury.initialize(
        config.treasury.minDelay,
        [], // governor will be added as a proposer later
        [ethers.constants.AddressZero], // let anyone execute proposals
        deployer // temporary admin role for deployer
    ).then(tx => tx.wait())

    const livepeerGovernor = await contractDeployer.deployAndRegister({
        contract: "LivepeerGovernor",
        name: "LivepeerGovernor",
        args: [controller.address],
        proxy: true
    })
    const LivepeerGovernor: LivepeerGovernor = await ethers.getContractAt(
        "LivepeerGovernor",
        livepeerGovernor.address
    )

    // Now grant proposer and executor roles to governor and renounce deployer admin role
    const roles = {
        proposer: await Treasury.PROPOSER_ROLE(),
        canceller: await Treasury.CANCELLER_ROLE(),
        executor: await Treasury.EXECUTOR_ROLE(),
        admin: await Treasury.TIMELOCK_ADMIN_ROLE()
    }
    for (const role of [roles.proposer, roles.canceller, roles.executor]) {
        await Treasury.grantRole(role, LivepeerGovernor.address).then(tx =>
            tx.wait()
        )
    }

    await Treasury.renounceRole(roles.admin, deployer).then(tx => tx.wait())

    const gitCommitHash = await contractDeployer.getGitHeadCommitHash()
    const contractAddressRef = async (name: string) => {
        const address = await deployments.get(name)
        const lowerName = name[0].toLowerCase() + name.slice(1)
        return `${address} (ADDRESSES.{network}.${lowerName})`
    }
    const registerAction = async (name: string) => ({
        target: await contractAddressRef("Controller"),
        value: "0",
        contract: "Controller",
        name: "setContractInfo",
        params: [
            contractId(name),
            await contractAddressRef(name),
            gitCommitHash
        ]
    })
    const governanceActions = await Promise.all([
        registerAction("Treasury"),
        registerAction("BondingVotesTarget"),
        registerAction("BondingVotes"),
        registerAction("BondingManagerTarget"),
        registerAction("LivepeerGovernorTarget"),
        registerAction("LivepeerGovernor")
    ])

    const governorInitParams = [
        config.livepeerGovernor.initialVotingDelay,
        config.livepeerGovernor.initialVotingPeriod,
        config.livepeerGovernor.initialProposalThreshold,
        config.livepeerGovernor.initialQuorum,
        config.livepeerGovernor.quota
    ] as Parameters<typeof LivepeerGovernor.initialize>

    // We can only initialize the LivepeerGovernor if we are registering deploys on the controller.
    // LivepeerGovernorTarget (for proxy), BondingVotes and Treasury (for initialize) need to be registered.
    if (!skipRegister) {
        await LivepeerGovernor.initialize(...governorInitParams).then(tx =>
            tx.wait()
        )
    } else {
        governanceActions.push({
            target: await contractAddressRef("LivepeerGovernor"),
            value: "0",
            contract: "LivepeerGovernor",
            name: "initialize",
            params: [governorInitParams]
        })
    }

    const bondingManager = await deployments.get("BondingManager")
    const BondingManager: BondingManager = await ethers.getContractAt(
        "BondingManager",
        bondingManager.address
    )
    // Similarly, only set the params on BondingManager if we have already registered the new target
    if (!skipRegister) {
        await (
            await BondingManager.setTreasuryRewardCutRate(
                config.bondingManager.treasuryRewardCutRate
            )
        ).wait()
        await (
            await BondingManager.setTreasuryBalanceCeiling(
                config.bondingManager.treasuryBalanceCeiling
            )
        ).wait()
    } else {
        governanceActions.push(
            {
                target: await contractAddressRef("BondingManager"),
                value: "0",
                contract: "BondingManager",
                name: "setTreasuryRewardCutRate",
                params: [config.bondingManager.treasuryRewardCutRate]
            },
            {
                target: await contractAddressRef("BondingManager"),
                value: "0",
                contract: "BondingManager",
                name: "setTreasuryBalanceCeiling",
                params: [config.bondingManager.treasuryBalanceCeiling]
            }
        )
    }

    // Helper to print out / validate the pending Governor actions that will be required
    if (skipRegister) {
        const actions = [
            registerAction("Treasury"),
            registerAction("BondingVotesTarget"),
            registerAction("BondingVotes"),
            registerAction("BondingManagerTarget"),
            registerAction("LivepeerGovernorTarget"),
            registerAction("LivepeerGovernor"),
            {
                target: contractAddressRef("LivepeerGovernor"),
                value: "0",
                contract: "LivepeerGovernor",
                name: "initialize",
                params: [governorInitParams]
            }
        ]

        console.log("Pending governance actions:")
        console.log(JSON.stringify(actions, null, 2))
    }
}

func.tags = ["DELTA"]
export default func
