import {HardhatRuntimeEnvironment} from "hardhat/types"
import {DeployFunction} from "hardhat-deploy/types"

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
    const {deployments, getNamedAccounts} = hre
    const {deploy} = deployments

    const {deployer} = await getNamedAccounts()

    const controllerDeployment = await deployments.get("Controller")

    const deployResult = await deploy("ServiceRegistry", {
        from: deployer,
        args: [controllerDeployment.address],
        log: true
    })
    await deployments.save("AIServiceRegistry", deployResult)
}

func.tags = ["AI_SERVICE_REGISTRY"]
export default func
