const config = require("./migrations.config")
const ethAbi = require("ethereumjs-abi")
const ethUtil = require("ethereumjs-util")

const Controller = artifacts.require("Controller")
const Minter = artifacts.require("Minter")
const BondingManager = artifacts.require("BondingManager")
const JobsManager = artifacts.require("JobsManager")
const RoundsManager = artifacts.require("RoundsManager")
const IdentityVerifier = artifacts.require("IdentityVerifier")
const OraclizeVerifier = artifacts.require("OraclizeVerifier")
const LivepeerToken = artifacts.require("LivepeerToken")
const ManagerProxy = artifacts.require("ManagerProxy")

module.exports = function(deployer, network) {
    let controller
    let token
    let bondingManagerProxy
    let jobsManagerProxy
    let roundsManagerProxy

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
        if (network == "development") {
            return controller.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["Verifier"])), IdentityVerifier.address)
        } else {
            return controller.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["Verifier"])), OraclizeVerifier.address)
        }
    }).then(() => {
        // Register upgradeable proxy target contracts
        return Promise.all([
            controller.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["BondingManagerTarget"])), BondingManager.address),
            controller.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["JobsManagerTarget"])), JobsManager.address),
            controller.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["RoundsManagerTarget"])), RoundsManager.address)
        ])
    }).then(() => {
        // Deploy proxy contracts
        return Promise.all([
            ManagerProxy.new(Controller.address, ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["BondingManagerTarget"]))),
            ManagerProxy.new(Controller.address, ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["JobsManagerTarget"]))),
            ManagerProxy.new(Controller.address, ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["RoundsManagerTarget"])))
        ])
    }).then(proxies => {
        [bondingManagerProxy, jobsManagerProxy, roundsManagerProxy] = proxies

        // Register proxy contracts
        return Promise.all([
            controller.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["BondingManager"])), bondingManagerProxy.address),
            controller.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["JobsManager"])), jobsManagerProxy.address),
            controller.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["RoundsManager"])), roundsManagerProxy.address)
        ])
    }).then(() => {
        // Cast proxiy contracts into target contracts
        return Promise.all([
            BondingManager.at(bondingManagerProxy.address),
            JobsManager.at(jobsManagerProxy.address),
            RoundsManager.at(roundsManagerProxy.address)
        ])
    }).then(managers => {
        const [bondingManager, jobsManager, roundsManager] = managers

        return Promise.all([
            bondingManager.initialize(config.bondingManager.numActiveTranscoders, config.bondingManager.unbondingPeriod),
            jobsManager.initialize(
                config.jobsManager.verificationRate,
                config.jobsManager.jobEndingPeriod,
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
