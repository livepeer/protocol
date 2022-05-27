import {HardhatRuntimeEnvironment} from "hardhat/types"
import {DeployFunction} from "hardhat-deploy/types"

import ContractDeployer from "../utils/deployer"

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
    const {deployments, getNamedAccounts} = hre // Get the deployments and getNamedAccounts which are provided by hardhat-deploy
    const {deploy, get} = deployments // the deployments object itself contains the deploy function

    const {deployer} = await getNamedAccounts() // Fetch named accounts from hardhat.config.ts

    const contractDeployer = new ContractDeployer(deploy, deployer, deployments)

    const bondingManager = await get("BondingManager")

    await contractDeployer.deployAndRegister({
        contract: "PollCreator",
        name: "PollCreator",
        args: [bondingManager.address]
    })
}

func.dependencies = ["Contracts"]
func.tags = ["Poll"]
export default func
