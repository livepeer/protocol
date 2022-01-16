import {HardhatRuntimeEnvironment} from "hardhat/types"
import {DeployFunction} from "hardhat-deploy/types"

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
    const {deployments, getNamedAccounts} = hre
    const {deploy, get} = deployments

    const {deployer} = await getNamedAccounts()

    const controller = await get("Controller")
    const ll = await get("SortedDoublyLL")

    const bondingManagerTarget = await deploy("BondingManager", {
        from: deployer,
        log: true,
        args: [controller.address],
        libraries: {
            SortedDoublyLL: ll.address
        }
    })

    await deployments.save("BondingManagerTarget", bondingManagerTarget)
}

func.tags = ["BONDING_MANAGER"]
export default func
