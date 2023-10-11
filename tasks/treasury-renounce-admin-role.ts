import {task} from "hardhat/config"
import {Treasury} from "../typechain"

task(
    "treasury-renounce-admin-role",
    "Renounces the admin role from the deployer once everything is good to go"
).setAction(async (taskArgs, hre) => {
    const {ethers, deployments} = hre

    const {deployer} = await hre.getNamedAccounts()

    const treasury = await deployments.get("Treasury")
    const Treasury: Treasury = await ethers.getContractAt(
        "Treasury",
        treasury.address
    )

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
