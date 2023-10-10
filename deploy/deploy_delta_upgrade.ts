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

// Returns a reference to the given contract in the format used by the governor-scripts repo (e.g.
// "ADDRESSES.arbitrumMainnet.controller"). Notice that on the serialized JSON, this will come out as a string while in
// the governance script it should be de-stringified (remove quotes) to reference an imported ADDRESS object.
const contractAddressRef = (network: string, name: string) => {
    const lowerName = name[0].toLowerCase() + name.slice(1)
    return `ADDRESSES.${network}.${lowerName}`
}

// Returns a governance action spec in the format expected by the governor-scripts to call the setContractInfo function
// on the controller to register a contract in the protocol.
const setContractInfoAction = (
    network: string,
    gitCommitHash: string,
    name: string
) => ({
    target: contractAddressRef(network, "Controller"),
    value: "0",
    contract: "Controller",
    name: "setContractInfo",
    params: [contractId(name), contractAddressRef(network, name), gitCommitHash]
})

// Deploys the Livepeer Delta protocol upgrade from the previous version (962107f). This deploys only the targets
// for already existing contracts, and skips registering them in the controller in case it's a production network.
const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
    const {deployments, getNamedAccounts} = hre // Get the deployments and getNamedAccounts which are provided by hardhat-deploy

    const network = hre.network.name
    const config = getNetworkConfig(network)

    const {deployer} = await getNamedAccounts() // Fetch named accounts from hardhat.config.ts

    const contractDeployer = new ContractDeployer(deployer, deployments)
    const controller = await contractDeployer.fetchDeployedController()

    // on prod networks, deploy contracts here but registration is done later through governance
    // on test networks, the deployer must also be the controller owner so we can register here
    const skipRegister = isProdNetwork(network)
    const deploy = skipRegister ?
        contractDeployer.deploy.bind(contractDeployer) :
        contractDeployer.deployAndRegister.bind(contractDeployer)

    const gitCommitHash = await contractDeployer.getGitHeadCommitHash()
    const governanceActions = []

    // Deploy contracts
    await deploy({
        contract: "BondingVotes",
        name: "BondingVotes",
        args: [controller.address],
        proxy: true
    })
    governanceActions.push(
        setContractInfoAction(network, gitCommitHash, "BondingVotesTarget"),
        setContractInfoAction(network, gitCommitHash, "BondingVotes")
    )

    const treasury = await deploy({
        contract: "Treasury",
        name: "Treasury",
        args: [],
        proxy: false
    })
    governanceActions.push(
        setContractInfoAction(network, gitCommitHash, "Treasury")
    )

    const Treasury: Treasury = await ethers.getContractAt(
        "Treasury",
        treasury.address
    )

    // We should already initialize the treasury since it's not a proxy
    await Treasury.initialize(
        config.treasury.minDelay,
        [], // governor will be added as a proposer later
        [], // governor will be added as an executor later
        deployer // temporary admin role for deployer
    ).then(tx => tx.wait())

    const livepeerGovernor = await deploy({
        contract: "LivepeerGovernor",
        name: "LivepeerGovernor",
        args: [controller.address],
        proxy: true
    })
    governanceActions.push(
        setContractInfoAction(network, gitCommitHash, "LivepeerGovernorTarget"),
        setContractInfoAction(network, gitCommitHash, "LivepeerGovernor")
    )

    const llDeployment = await deployments.get("SortedDoublyLL")

    await deploy({
        contract: "BondingManager",
        name: "BondingManagerTarget",
        libraries: {
            SortedDoublyLL: llDeployment.address
        },
        args: [controller.address],
        proxy: false // we're deploying the Target directly, so proxy is false
    })
    governanceActions.push(
        setContractInfoAction(network, gitCommitHash, "BondingManagerTarget")
    )

    // Setup/initialize contracts (or print the required governance actions)

    // Grant proposer and executor roles to governor and renounce deployer admin role
    const roles = {
        proposer: await Treasury.PROPOSER_ROLE(),
        canceller: await Treasury.CANCELLER_ROLE(),
        executor: await Treasury.EXECUTOR_ROLE(),
        admin: await Treasury.TIMELOCK_ADMIN_ROLE()
    }
    for (const role of [roles.proposer, roles.canceller, roles.executor]) {
        await Treasury.grantRole(role, livepeerGovernor.address).then(tx =>
            tx.wait()
        )
    }

    const LivepeerGovernor: LivepeerGovernor = await ethers.getContractAt(
        "LivepeerGovernor",
        livepeerGovernor.address
    )
    const governorInitParams = [
        config.livepeerGovernor.initialVotingDelay,
        config.livepeerGovernor.initialVotingPeriod,
        config.livepeerGovernor.initialProposalThreshold,
        config.livepeerGovernor.initialQuorum,
        config.livepeerGovernor.quota
    ] as Parameters<typeof LivepeerGovernor.initialize>

    if (!skipRegister) {
        await LivepeerGovernor.initialize(...governorInitParams).then(tx =>
            tx.wait()
        )
    } else {
        governanceActions.push({
            target: contractAddressRef(network, "LivepeerGovernor"),
            value: "0",
            contract: "LivepeerGovernor",
            name: "initialize",
            params: governorInitParams
        })
    }

    if (!skipRegister) {
        // We need to refetch the BondingManager contract as we only deploy the Target above
        const bondingManager = await deployments.get("BondingManager")
        const BondingManager: BondingManager = await ethers.getContractAt(
            "BondingManager",
            bondingManager.address
        )

        await BondingManager.setTreasuryRewardCutRate(
            config.bondingManager.treasuryRewardCutRate
        ).then(tx => tx.wait())
        await BondingManager.setTreasuryBalanceCeiling(
            config.bondingManager.treasuryBalanceCeiling
        ).then(tx => tx.wait())
    } else {
        governanceActions.push(
            {
                target: contractAddressRef(network, "BondingManager"),
                value: "0",
                contract: "BondingManager",
                name: "setTreasuryRewardCutRate",
                params: [config.bondingManager.treasuryRewardCutRate]
            },
            {
                target: contractAddressRef(network, "BondingManager"),
                value: "0",
                contract: "BondingManager",
                name: "setTreasuryBalanceCeiling",
                params: [config.bondingManager.treasuryBalanceCeiling]
            }
        )
    }

    // Helper print out to validate the pending governance actions that will be required by the protocol owner
    if (skipRegister) {
        console.log("Pending governance actions:")
        console.log(JSON.stringify(governanceActions, null, 2))
    }

    // deployer MUST renounce ADMIN role from the Treasury afterwards
}

func.tags = ["DELTA_UPGRADE"]
export default func
