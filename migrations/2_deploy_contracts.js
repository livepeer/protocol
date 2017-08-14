const Node = artifacts.require("Node")
const MinHeap = artifacts.require("MinHeap")
const MaxHeap = artifacts.require("MaxHeap")
const TranscoderPools = artifacts.require("TranscoderPools")
const MerkleProof = artifacts.require("MerkleProof")
const ECRecovery = artifacts.require("ECRecovery")
const JobLib = artifacts.require("JobLib")
const JobsManager = artifacts.require("JobsManager")
const BondingManager = artifacts.require("BondingManager")

module.exports = function(deployer) {
    deployer.deploy(Node)
    deployer.link(Node, [
        MinHeap,
        MaxHeap,
    ])

    deployer.deploy(MinHeap)
    deployer.link(MinHeap, TranscoderPools)

    deployer.deploy(MaxHeap)
    deployer.link(MaxHeap, TranscoderPools)

    deployer.deploy(TranscoderPools)
    deployer.link(TranscoderPools, BondingManager)

    deployer.deploy(MerkleProof)
    deployer.link(MerkleProof, JobsManager)

    deployer.deploy(ECRecovery)
    deployer.link(ECRecovery, JobsManager)

    deployer.deploy(JobLib)
    deployer.link(JobLib, JobsManager)
}
