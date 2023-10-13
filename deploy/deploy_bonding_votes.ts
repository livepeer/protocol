import {HardhatRuntimeEnvironment} from "hardhat/types"
import {DeployFunction} from "hardhat-deploy/types"

import ContractDeployer from "../utils/deployer"

const PROD_NETWORKS = ["mainnet", "arbitrumMainnet"]

const isProdNetwork = (name: string): boolean => {
    return PROD_NETWORKS.indexOf(name) > -1
}

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
    const {deployments, getNamedAccounts} = hre // Get the deployments and getNamedAccounts which are provided by hardhat-deploy

    const {deployer} = await getNamedAccounts() // Fetch named accounts from hardhat.config.ts

    const contractDeployer = new ContractDeployer(deployer, deployments)
    const controller = await contractDeployer.fetchDeployedController()

    const deploy = isProdNetwork(hre.network.name) ?
        contractDeployer.deploy.bind(contractDeployer) :
        contractDeployer.deployAndRegister.bind(contractDeployer)

    await deploy({
        contract: "BondingVotes",
        name: "BondingVotesTarget",
        args: [controller.address],
        proxy: false // deploying only the target
    })
}

func.tags = ["BONDING_VOTES"]
export default func
