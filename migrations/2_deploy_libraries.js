const SortedDoublyLL = artifacts.require("SortedDoublyLL")
const BondingManager = artifacts.require("BondingManager")

module.exports = function(deployer, network) {
    if (network  === "unitTest") return
    deployer.deploy(SortedDoublyLL)
    deployer.link(SortedDoublyLL, BondingManager)
}
