const SortedDoublyLL = artifacts.require("SortedDoublyLL")
const MerkleProof = artifacts.require("MerkleProof")
const ECRecovery = artifacts.require("ECRecovery")
const JobLib = artifacts.require("JobLib")

const JobsManager = artifacts.require("JobsManager")
const BondingManager = artifacts.require("BondingManager")
const MerkleMine = artifacts.require("MerkleMine")

module.exports = function(deployer) {
    deployer.deploy(SortedDoublyLL)
    deployer.link(SortedDoublyLL, BondingManager)

    deployer.deploy(MerkleProof)
    deployer.link(MerkleProof, JobLib)
    deployer.link(MerkleProof, MerkleMine)

    deployer.deploy(ECRecovery)
    deployer.link(ECRecovery, JobLib)

    deployer.deploy(JobLib)
    deployer.link(JobLib, JobsManager)
}
