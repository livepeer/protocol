var Node = artifacts.require("Node")
var MinHeap = artifacts.require("MinHeap");
var MaxHeap = artifacts.require("MaxHeap");
var TranscoderPools = artifacts.require("TranscoderPools")
var ECVerify = artifacts.require("ECVerify");
var MerkleProof = artifacts.require("MerkleProof")
var TranscodeJobs = artifacts.require("TranscodeJobs")
var BondingManager = artifacts.require("BondingManager")
var RoundsManager = artifacts.require("RoundsManager")
var JobsManager = artifacts.require("JobsManager")
var LivepeerToken = artifacts.require("LivepeerToken");
var LivepeerProtocol = artifacts.require("LivepeerProtocol");

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

    deployer.deploy(MerkleProof)
    deployer.link(MerkleProof, TranscodeJobs)

    deployer.deploy(TranscodeJobs)
    deployer.link(TranscodeJobs, JobsManager)

    deployer.deploy(LivepeerToken).then(() => {
        deployer.deploy(BondingManager, LivepeerToken.address)
    })

    deployer.deploy(LivepeerProtocol)
    deployer.deploy(JobsManager)
    deployer.deploy(RoundsManager)
};
