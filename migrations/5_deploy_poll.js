const {contractId} = require("../utils/helpers")

const Controller = artifacts.require("Controller")
const PollCreator = artifacts.require("PollCreator")

module.exports = function(deployer, network) {
    if (network === "unitTest") {
        return
    }

    deployer.then(async () => {
        const controller = await Controller.deployed()
        const tokenAddr = await controller.getContract(contractId("LivepeerToken"))

        await deployer.deploy(PollCreator, tokenAddr)
    })
}
