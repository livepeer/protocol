const Controller = artifacts.require("Controller")
const genesisConfig = require("../migrations/genesis.config.js")

module.exports = async () => {
    const controller = await Controller.deployed()

    console.log(`Transferring ownership of the Controller at ${controller.address} to the governance multisig at ${genesisConfig.governanceMultisig}...`)

    await controller.transferOwnership(genesisConfig.governanceMultisig)

    const newOwner = await controller.owner()
    console.log(`Controller at ${controller.address} is now owned by ${newOwner}`)
}
