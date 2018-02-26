const SortedDoublyLL = artifacts.require("SortedDoublyLL")
const EarningsPool = artifacts.require("EarningsPool")
const MerkleProof = artifacts.require("MerkleProof")
const ECRecovery = artifacts.require("ECRecovery")
const JobLib = artifacts.require("JobLib")
const SafeMath = artifacts.require("SafeMath")
const MathUtils = artifacts.require("MathUtils")

const Minter = artifacts.require("Minter")
const JobsManager = artifacts.require("JobsManager")
const BondingManager = artifacts.require("BondingManager")
const RoundsManager = artifacts.require("RoundsManager")

module.exports = function(deployer) {
    deployer.deploy(SafeMath)
    deployer.link(SafeMath, [
        BondingManager,
        JobsManager,
        RoundsManager,
        SortedDoublyLL,
        MathUtils
    ])

    deployer.deploy(MathUtils)
    deployer.link(MathUtils, [
        BondingManager,
        JobsManager,
        RoundsManager,
        Minter,
        EarningsPool
    ])

    deployer.deploy(SortedDoublyLL)
    deployer.link(SortedDoublyLL, BondingManager)

    deployer.deploy(EarningsPool)
    deployer.link(EarningsPool, BondingManager)

    deployer.deploy(MerkleProof)
    deployer.link(MerkleProof, JobLib)

    deployer.deploy(ECRecovery)
    deployer.link(ECRecovery, JobLib)

    deployer.deploy(JobLib)
    deployer.link(JobLib, JobsManager)
}
