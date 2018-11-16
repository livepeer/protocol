const SortedDoublyLL = artifacts.require("SortedDoublyLL")
const BondingManager = artifacts.require("BondingManager")

module.exports = function(deployer) {
    deployer.deploy(SortedDoublyLL)
    deployer.link(SortedDoublyLL, BondingManager)
}
