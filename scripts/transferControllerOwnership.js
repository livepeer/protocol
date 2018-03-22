const Controller = artifacts.require("Controller")
const genesisConfig = require("../migrations/genesis.config.js")

module.exports = async () => {
    const controller = await Controller.deployed()
    await controller.transferOwnership(genesisConfig.governanceMultisig)
}
