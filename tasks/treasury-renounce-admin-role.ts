import {task} from "hardhat/config"
import {Controller, Treasury} from "../typechain"
import {contractId} from "../utils/helpers"

task(
    "treasury-renounce-admin-role",
    "Renounces the admin role from the deployer once everything is good to go"
).setAction(async (taskArgs, hre) => {
    const {ethers, deployments} = hre

    const {deployer} = await hre.getNamedAccounts()

    const controller = await deployments.get("Controller")
    const Controller: Controller = await hre.ethers.getContractAt(
        "Controller",
        controller.address
    )

    const address = await Controller.getContract(contractId("Treasury"))
    const Treasury: Treasury = await ethers.getContractAt("Treasury", address)

    const adminRole = await Treasury.TIMELOCK_ADMIN_ROLE()
    let hasAdminRole = await Treasury.hasRole(adminRole, deployer)
    if (!hasAdminRole) {
        console.log("Deployer does not have admin role")
        return
    }

    console.log("Renouncing admin role")
    await Treasury.renounceRole(adminRole, deployer).then(tx => tx.wait())

    hasAdminRole = await Treasury.hasRole(adminRole, deployer)
    if (hasAdminRole) {
        throw new Error("Deployer still has admin role")
    }

    console.log("Success!")
})
