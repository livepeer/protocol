const TranscoderPool = artifacts.require("TranscoderPool")
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
    deployer.deploy(TranscoderPool)
    deployer.deploy(SafeMath)
    deployer.link(SafeMath, [
        BondingManager,
        JobsManager,
        RoundsManager,
        OraclizeVerifier,
        TranscoderPool
    ])

    deployer.deploy(TranscoderPool)
    deployer.link(TranscoderPool, BondingManager)

    deployer.deploy(TokenPools)
    deployer.link(TokenPools, BondingManager)

    deployer.deploy(MerkleProof)
    deployer.link(MerkleProof, JobLib)

    deployer.deploy(ECRecovery)
    deployer.link(ECRecovery, JobLib)

    deployer.deploy(JobLib)
    deployer.link(JobLib, JobsManager)
}
