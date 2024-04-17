import {HardhatRuntimeEnvironment} from "hardhat/types"
import {DeployFunction} from "hardhat-deploy/types"

import ContractDeployer from "../utils/deployer"

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
    const {deployments, getNamedAccounts} = hre // Get the deployments and getNamedAccounts which are provided by hardhat-deploy

    const {deployer} = await getNamedAccounts() // Fetch named accounts from hardhat.config.ts

    const contractDeployer = new ContractDeployer(deployer, deployments)
    const controller = await contractDeployer.fetchDeployedController()

    const deploy = contractDeployer.deploy.bind(contractDeployer)

    await deploy({
        contract: "ServiceRegistry",
        name: "AIServiceRegistry",
        args: [controller.address],
        proxy: true
    })
}

func.tags = ["AI_SERVICE_REGISTRY"]
export default func
