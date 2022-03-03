import {HardhatRuntimeEnvironment} from "hardhat/types"
import {DeployFunction} from "hardhat-deploy/types"

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
    const {deployments, getNamedAccounts} = hre
    const {deploy} = deployments

    const {deployer} = await getNamedAccounts()

    const controllerDeployment = await deployments.get("Controller")

    const deployResult = await deploy("TicketBroker", {
        from: deployer,
        args: [controllerDeployment.address],
        log: true
    })
    await deployments.save("TicketBrokerTarget", deployResult)
}

func.tags = ["TICKET_BROKER"]
export default func
