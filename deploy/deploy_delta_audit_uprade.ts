import {HardhatRuntimeEnvironment} from "hardhat/types"
import {DeployFunction} from "hardhat-deploy/types"

import ContractDeployer from "../utils/deployer"

const PROD_NETWORKS = ["mainnet", "arbitrumMainnet"]

const isProdNetwork = (name: string): boolean => {
    return PROD_NETWORKS.indexOf(name) > -1
}

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
    const {deployments, getNamedAccounts} = hre // Get the deployments and getNamedAccounts which are provided by hardhat-deploy
    const {deploy} = deployments // the deployments object itself contains the deploy function

    const {deployer} = await getNamedAccounts() // Fetch named accounts from hardhat.config.ts

    const contractDeployer = new ContractDeployer(deploy, deployer, deployments)
    const controller = isProdNetwork(hre.network.name) ?
        await deployments.get("Controller") : // on prod networks, deploy contracts here but registration is done through governance
        await contractDeployer.fetchDeployedController() // on test networks, the deployer must also be the controller owner

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
        name: "BondingVotesTarget",
        args: [controller.address],
        proxy: false // we're deploying the Target directly, so proxy is false
    })

    await contractDeployer.deployAndRegister({
        contract: "LivepeerGovernor",
        name: "LivepeerGovernorTarget",
        args: [controller.address],
        proxy: false // we're deploying the Target directly, so proxy is false
    })
}

func.tags = ["DeltaAuditUpgrade"]
export default func
