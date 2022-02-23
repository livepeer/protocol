import {HardhatRuntimeEnvironment} from "hardhat/types"
import {DeployFunction} from "hardhat-deploy/types"

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
    const {deployments, getNamedAccounts} = hre
    const {deploy} = deployments

    const {deployer} = await getNamedAccounts()

    const controllerDeployment = await deployments.get("Controller")
    const llDeployment = await deployments.get("SortedDoublyLL")

    const deployResult = await deploy("BondingManager", {
        from: deployer,
        args: [controllerDeployment.address],
        libraries: {
            SortedDoublyLL: llDeployment.address
        },
        log: true
    })
    await deployments.save("BondingManagerTarget", deployResult)
}

func.tags = ["BONDING_MANAGER"]
export default func
