import {task} from "hardhat/config"
import {contractId} from "../utils/helpers"

task("set-round-length", "Set round length in the RoundsManager")
    .addParam("roundlength", "Round length in blocks")
    .setAction(async (taskArgs, hre) => {
        const {deployments, ethers} = hre
        const controllerDeployment = await deployments.get("Controller")
        const controller = await ethers.getContractAt(
            "Controller",
            controllerDeployment.address
        )

        const id = contractId("RoundsManager")
        const info = await controller.getContractInfo(id)
        const addr = info[0]

        const roundsManager = await ethers.getContractAt("RoundsManager", addr)

        await (await roundsManager.setRoundLength(taskArgs.roundlength)).wait()

        console.log(
            `RoundsManager roundLength=${await roundsManager.roundLength()}`
        )
    })
