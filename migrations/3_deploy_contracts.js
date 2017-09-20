// const config = require("./migrations.config.js")

// const JobsManager = artifacts.require("JobsManager")
// const BondingManager = artifacts.require("BondingManager")
// const RoundsManager = artifacts.require("RoundsManager")
// const IdentityVerifier = artifacts.require("IdentityVerifier")
// // const OraclizeVerifier = artifacts.require("OraclizeVerifier")
// const LivepeerProtocol = artifacts.require("LivepeerProtocol")
// const LivepeerToken = artifacts.require("LivepeerToken")

module.exports = function(deployer, network) {
    // deployer.deploy([
    //     LivepeerProtocol,
    //     LivepeerToken
    // ]).then(() => {
    //     if (network == "development") {
    //         return deployer.deploy(IdentityVerifier)
    //     } else {
    //         return deployer.deploy(IdentityVerifier)
    //         // return deployer.deploy(OraclizeVerifier)
    //     }
    // }).then(() => {
    //     return deployer.deploy(
    //         JobsManager,
    //         LivepeerProtocol.address,
    //         LivepeerToken.address,
    //         IdentityVerifier.address,
    //         // network == "development" ? IdentityVerifier.address : OraclizeVerifier.address,
    //         config.jobsManager.verificationRate,
    //         config.jobsManager.jobEndingPeriod,
    //         config.jobsManager.verificationPeriod,
    //         config.jobsManager.slashingPeriod,
    //         config.jobsManager.failedVerificationSlashAmount,
    //         config.jobsManager.missedVerificationSlashAmount,
    //         config.jobsManager.finderFee
    //     )
    // }).then(() => {
    //     return deployer.deploy([
    //         [BondingManager, LivepeerProtocol.address, LivepeerToken.address, config.bondingManager.numActiveTranscoders, config.bondingManager.unbondingPeriod],
    //         [RoundsManager, LivepeerProtocol.address, config.roundsManager.blockTime, config.roundsManager.roundLength]
    //     ])
    // })
}
