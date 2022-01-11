import {task} from "hardhat/config"

task("unpause", "Unpause the Controller").setAction(async (_, hre) => {
    const {deployments, ethers} = hre
    const controllerDeployment = await deployments.get("Controller")
    const controller = await ethers.getContractAt(
        "Controller",
        controllerDeployment.address
    )

    const paused = await controller.paused()
    if (!paused) {
        throw new Error(`Controller ${controller.address} paused=${paused}`)
    }

    await controller.unpause()

    console.log(
        `Controller ${controller.address} paused=${await controller.paused()}`
    )
})
