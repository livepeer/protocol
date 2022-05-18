import {task} from "hardhat/config"

task("print-contract-address", "Print a deployed contract address")
    .addParam("contract", "Contract name")
    .setAction(async (taskArgs, hre) => {
        const {deployments} = hre
        const contractDeployment = await deployments.get(taskArgs.contract)
        console.log(contractDeployment.address)
    })
