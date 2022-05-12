import {HardhatRuntimeEnvironment} from "hardhat/types"
import {DeployFunction} from "hardhat-deploy/types"
import {contractId} from "../utils/helpers"

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
    const {deployments, getNamedAccounts, ethers} = hre
    const {deploy, get} = deployments

    const {deployer} = await getNamedAccounts()

    const deployResult = await deploy("DummyL2LPTDataCache", {
        from: deployer,
        log: true
    })

    const controllerDeployment = await get("Controller")
    const controller = await ethers.getContractAt(
        "Controller",
        controllerDeployment.address
    )

    const id = contractId("L2LPTDataCache")
    await controller.setContractInfo(
        id,
        deployResult.address,
        "0x1111111111111111111111111111111111111111"
    )
}

func.tags = ["ARBITRUM_LPT_DUMMIES"]
export default func
