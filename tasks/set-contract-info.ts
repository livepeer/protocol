import {task} from "hardhat/config"
import {contractId} from "../utils/helpers"

task("set-contract-info", "Set contract info in the Controller")
    .addParam("name", "Contract name")
    .addParam("address", "Contract address")
    .addParam("gitcommithash", "Git commit hash")
    .setAction(async (taskArgs, hre) => {
        const {deployments, ethers} = hre
        const controllerDeployment = await deployments.get("Controller")
        const controller = await ethers.getContractAt(
            "Controller",
            controllerDeployment.address
        )

        const id = contractId(taskArgs.name)
        await controller.setContractInfo(
            id,
            taskArgs.address,
            taskArgs.gitcommithash
        )

        const info = await controller.getContractInfo(id)

        console.log(
            `${taskArgs.name} registered in Controller address=${info[0]} gitCommitHash=${info[1]}`
        )
    })
