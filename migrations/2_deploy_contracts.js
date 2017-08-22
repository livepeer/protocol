const ethAbi = require("ethereumjs-abi")
const ethUtil = require("ethereumjs-util")

const Node = artifacts.require("Node")
const MinHeap = artifacts.require("MinHeap")
const MaxHeap = artifacts.require("MaxHeap")
const TranscoderPools = artifacts.require("TranscoderPools")
const MerkleProof = artifacts.require("MerkleProof")
const ECRecovery = artifacts.require("ECRecovery")
const JobLib = artifacts.require("JobLib")
const SafeMath = artifacts.require("SafeMath")
const JobsManager = artifacts.require("JobsManager")
const BondingManager = artifacts.require("BondingManager")
const RoundsManager = artifacts.require("RoundsManager")
const IdentityVerifier = artifacts.require("IdentityVerifier")
const LivepeerProtocol = artifacts.require("LivepeerProtocol")
const LivepeerToken = artifacts.require("LivepeerToken")

module.exports = async function(deployer) {
    await deployer.deploy(SafeMath)
    deployer.link(SafeMath, [
        BondingManager,
        JobsManager,
        RoundsManager,
        MaxHeap,
        MinHeap,
    ])

    await deployer.deploy(Node)
    deployer.link(Node, [
        MinHeap,
        MaxHeap,
    ])

    await deployer.deploy(MinHeap)
    deployer.link(MinHeap, TranscoderPools)

    await deployer.deploy(MaxHeap)
    deployer.link(MaxHeap, TranscoderPools)

    await deployer.deploy(TranscoderPools)
    deployer.link(TranscoderPools, BondingManager)

    await deployer.deploy(MerkleProof)
    deployer.link(MerkleProof, JobsManager)

    await deployer.deploy(ECRecovery)
    deployer.link(ECRecovery, JobsManager)

    await deployer.deploy(JobLib)
    deployer.link(JobLib, JobsManager)

    await deployer.deploy(IdentityVerifier)
    await deployer.deploy(LivepeerToken)
    await deployer.deploy(LivepeerProtocol)
    await deployer.deploy(BondingManager, LivepeerProtocol.address, LivepeerToken.address, 1)
    await deployer.deploy(JobsManager, LivepeerProtocol.address, LivepeerToken.address, IdentityVerifier.address)
    await deployer.deploy(RoundsManager, LivepeerProtocol.address)

    const protocol = await LivepeerProtocol.deployed()

    await protocol.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["BondingManager"])), BondingManager.address)
    console.log("Registered BondingManager with LivepeerProtocol")
    await protocol.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["JobsManager"])), JobsManager.address)
    console.log("Registered JobsManager with LivepeerProtocol")
    await protocol.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["RoundsManager"])), RoundsManager.address)
    console.log("Registered RoundsManager with LivepeerProtocol")

    const token = await LivepeerToken.deployed()

    await token.transferOwnership(BondingManager.address)
    console.log("Transferred ownership of LivepeerToken to BondingManager")

    // Unpause all contracts
    await protocol.unpause()
    console.log("Unpaused protocol")
}
