const Node = artifacts.require("Node")
const MinHeap = artifacts.require("MinHeap")
const MaxHeap = artifacts.require("MaxHeap")
const TranscoderPools = artifacts.require("TranscoderPools")
const ECVerify = artifacts.require("ECVerify")
const MerkleProof = artifacts.require("MerkleProof")
const TranscodeJobs = artifacts.require("TranscodeJobs")
const BondingManager = artifacts.require("BondingManager")
const RoundsManager = artifacts.require("RoundsManager")
const JobsManager = artifacts.require("JobsManager")
const IdentityVerifier = artifacts.require("IdentityVerifier")
const LivepeerToken = artifacts.require("LivepeerToken")
const LivepeerProtocol = artifacts.require("LivepeerProtocol")

module.exports = function(deployer) {
    deployer.deploy(Node)
    deployer.link(Node, MinHeap)
    deployer.link(Node, MaxHeap)

    deployer.deploy(MinHeap)
    deployer.link(MinHeap, TranscoderPools)

    deployer.deploy(MaxHeap)
    deployer.link(MaxHeap, TranscoderPools)

    deployer.deploy(TranscoderPools)
    deployer.link(TranscoderPools, BondingManager)

    deployer.deploy(ECVerify)
    deployer.link(ECVerify, TranscodeJobs)
    deployer.link(ECVerify, JobsManager)

    deployer.deploy(MerkleProof)
    deployer.link(MerkleProof, TranscodeJobs)
    deployer.link(MerkleProof, JobsManager)

    deployer.deploy(TranscodeJobs)
    deployer.link(TranscodeJobs, JobsManager)

    deployer.deploy(LivepeerToken).then(() => {
        deployer.deploy(BondingManager, LivepeerToken.address)
    })

    deployer.deploy(IdentityVerifier).then(() => {
        deployer.deploy(JobsManager, IdentityVerifier.address)
    })

    deployer.deploy(RoundsManager)
    deployer.deploy(LivepeerProtocol)
}
