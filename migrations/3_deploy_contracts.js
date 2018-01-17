const config = require("./migrations.config.js")
const ContractDeployer = require("../utils/contractDeployer")

const Controller = artifacts.require("Controller")
const Minter = artifacts.require("Minter")
const BondingManager = artifacts.require("BondingManager")
const JobsManager = artifacts.require("JobsManager")
const RoundsManager = artifacts.require("RoundsManager")
const AdjustableRoundsManager = artifacts.require("AdjustableRoundsManager")
const IdentityVerifier = artifacts.require("IdentityVerifier")
const LivepeerVerifier = artifacts.require("LivepeerVerifier")
const OraclizeVerifier = artifacts.require("OraclizeVerifier")
const LivepeerToken = artifacts.require("LivepeerToken")
const LivepeerTokenFaucet = artifacts.require("LivepeerTokenFaucet")
const ManagerProxy = artifacts.require("ManagerProxy")

module.exports = function(deployer, network) {
    deployer.then(async () => {
        const lpDeployer = new ContractDeployer(deployer, Controller, ManagerProxy)

        const controller = await lpDeployer.deployController()
        const token = await lpDeployer.deployAndRegister(LivepeerToken, "LivepeerToken")
        await lpDeployer.deployAndRegister(Minter, "Minter", controller.address, config.minter.inflation, config.minter.inflationChange, config.minter.targetBondingRate)

        if (network === "development" || network === "testrpc" || network === "parityDev" || network === "gethDev") {
            await lpDeployer.deployAndRegister(IdentityVerifier, "Verifier", controller.address)
        } else if (network === "lpTestNet") {
            await lpDeployer.deployAndRegister(LivepeerVerifier, "Verifier", controller.address, config.verifier.solvers, config.verifier.verificationCodeHash)
        } else {
            await lpDeployer.deployAndRegister(OraclizeVerifier, "Verifier", controller.address, config.verifier.verificationCodeHash, config.verifier.gasPrice, config.verifier.gasLimit)
        }

        await lpDeployer.deployAndRegister(LivepeerTokenFaucet, "LivepeerTokenFaucet", token.address, config.faucet.requestAmount, config.faucet.requestWait)

        const bondingManager = await lpDeployer.deployProxyAndRegister(BondingManager, "BondingManager", controller.address)
        const jobsManager = await lpDeployer.deployProxyAndRegister(JobsManager, "JobsManager", controller.address)

        let roundsManager

        if (network === "development" || network === "testrpc" || network === "parityDev" || network === "gethDev") {
            roundsManager = await lpDeployer.deployProxyAndRegister(AdjustableRoundsManager, "RoundsManager", controller.address)
        } else {
            roundsManager = await lpDeployer.deployProxyAndRegister(RoundsManager, "RoundsManager", controller.address)
        }

        deployer.logger.log("Initializing contracts...")

        await bondingManager.setParameters(config.bondingManager.unbondingPeriod, config.bondingManager.numTranscoders, config.bondingManager.numActiveTranscoders)
        await jobsManager.setParameters(
            config.jobsManager.verificationRate,
            config.jobsManager.verificationPeriod,
            config.jobsManager.slashingPeriod,
            config.jobsManager.failedVerificationSlashAmount,
            config.jobsManager.missedVerificationSlashAmount,
            config.jobsManager.doubleClaimSegmentSlashAmount,
            config.jobsManager.finderFee
        )
        await roundsManager.setParameters(config.roundsManager.roundLength, config.roundsManager.roundLockAmount)
    })
}
