const config = require("./migrations.config")
const ethAbi = require("ethereumjs-abi")
const ethUtil = require("ethereumjs-util")

const Controller = artifacts.require("Controller")
const Minter = artifacts.require("Minter")
const BondingManager = artifacts.require("BondingManager")
const JobsManager = artifacts.require("JobsManager")
const RoundsManager = artifacts.require("RoundsManager")
const IdentityVerifier = artifacts.require("IdentityVerifier")
const LivepeerVerifier = artifacts.require("LivepeerVerifier")
const OraclizeVerifier = artifacts.require("OraclizeVerifier")
const LivepeerToken = artifacts.require("LivepeerToken")

module.exports = function(deployer, network) {
    let controller
    let token

    deployer.then(() => {
        return Promise.all([
            Controller.deployed(),
            LivepeerToken.deployed()
        ])
    }).then(instances => {
        [controller, token] = instances

        // Register non-upgradeable contracts
        return Promise.all([
            controller.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["LivepeerToken"])), LivepeerToken.address),
            controller.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["Minter"])), Minter.address)
        ])
    }).then(() => {
        // Register Verifier
        if (network === "development" || network === "testrpc" || network === "parityDev" || network === "gethDev") {
            return controller.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["Verifier"])), IdentityVerifier.address)
        } else if (network === "lpTestNet") {
            return controller.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["Verifier"])), LivepeerVerifier.address)
        } else {
            return controller.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["Verifier"])), OraclizeVerifier.address)
        }
    }).then(() => {
        // Register contracts
        return Promise.all([
            controller.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["BondingManager"])), BondingManager.address),
            controller.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["JobsManager"])), JobsManager.address),
            controller.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["RoundsManager"])), RoundsManager.address)
        ])
    }).then(() => {
        return Promise.all([
            BondingManager.deployed(),
            JobsManager.deployed(),
            RoundsManager.deployed()
        ])
    }).then(managers => {
        const [bondingManager, jobsManager, roundsManager] = managers

        return Promise.all([
            bondingManager.initialize(config.bondingManager.numActiveTranscoders, config.bondingManager.unbondingPeriod),
            jobsManager.initialize(
                config.jobsManager.verificationRate,
                config.jobsManager.verificationPeriod,
                config.jobsManager.slashingPeriod,
                config.jobsManager.failedVerificationSlashAmount,
                config.jobsManager.missedVerificationSlashAmount,
                config.jobsManager.finderFee
            ),
            roundsManager.initialize(config.roundsManager.blockTime, config.roundsManager.roundLength)
        ])
    }).then(() => {
        return token.transferOwnership(Minter.address)
    })
}
