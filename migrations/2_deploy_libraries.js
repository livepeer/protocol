const Node = artifacts.require("Node")
const MinHeap = artifacts.require("MinHeap")
const MaxHeap = artifacts.require("MaxHeap")
const TranscoderPools = artifacts.require("TranscoderPools")
const TokenPools = artifacts.require("TokenPools")
const MerkleProof = artifacts.require("MerkleProof")
const ECRecovery = artifacts.require("ECRecovery")
const JobLib = artifacts.require("JobLib")
const SafeMath = artifacts.require("SafeMath")

const JobsManager = artifacts.require("JobsManager")
const BondingManager = artifacts.require("BondingManager")
const RoundsManager = artifacts.require("RoundsManager")
const OraclizeVerifier = artifacts.require("OraclizeVerifier")

module.exports = function(deployer) {
    deployer.deploy(SafeMath)
    deployer.link(SafeMath, [
        BondingManager,
        JobsManager,
        RoundsManager,
        OraclizeVerifier,
        MaxHeap,
        MinHeap
    ])

    deployer.deploy(Node)
    deployer.link(Node, [
        MinHeap,
        MaxHeap
    ])

    deployer.deploy(MinHeap)
    deployer.link(MinHeap, TranscoderPools)

    deployer.deploy(MaxHeap)
    deployer.link(MaxHeap, TranscoderPools)

    deployer.deploy(TranscoderPools)
    deployer.link(TranscoderPools, BondingManager)

    deployer.deploy(TokenPools)
    deployer.link(TokenPools, BondingManager)

    deployer.deploy(MerkleProof)
    deployer.link(MerkleProof, JobLib)

    deployer.deploy(ECRecovery)
    deployer.link(ECRecovery, JobLib)

    deployer.deploy(JobLib)
    deployer.link(JobLib, JobsManager)
}
