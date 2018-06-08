const config = require("./migrations.config.js")
const ContractDeployer = require("../utils/contractDeployer")

const Controller = artifacts.require("Controller")
const Minter = artifacts.require("Minter")
const ServiceRegistry = artifacts.require("ServiceRegistry")
const BondingManager = artifacts.require("BondingManager")
const JobsManager = artifacts.require("JobsManager")
const RoundsManager = artifacts.require("RoundsManager")
const AdjustableRoundsManager = artifacts.require("AdjustableRoundsManager")
const LivepeerVerifier = artifacts.require("LivepeerVerifier")
const LivepeerToken = artifacts.require("LivepeerToken")
const LivepeerTokenFaucet = artifacts.require("LivepeerTokenFaucet")
const ManagerProxy = artifacts.require("ManagerProxy")

module.exports = function(deployer, network) {
    deployer.then(async () => {
        const lpDeployer = new ContractDeployer(deployer, Controller, ManagerProxy)

        const controller = await lpDeployer.deployController()
        const token = await lpDeployer.deployAndRegister(LivepeerToken, "LivepeerToken")
        await lpDeployer.deployAndRegister(Minter, "Minter", controller.address, config.minter.inflation, config.minter.inflationChange, config.minter.targetBondingRate)
        await lpDeployer.deployAndRegister(LivepeerVerifier, "Verifier", controller.address, config.verifier.solver, config.verifier.verificationCodeHash)

        if (!lpDeployer.isProduction(network)) {
            // Only deploy a faucet if not in production
            await lpDeployer.deployAndRegister(LivepeerTokenFaucet, "LivepeerTokenFaucet", token.address, config.faucet.requestAmount, config.faucet.requestWait)
        }

        const bondingManager = await lpDeployer.deployProxyAndRegister(BondingManager, "BondingManager", controller.address)
        const jobsManager = await lpDeployer.deployProxyAndRegister(JobsManager, "JobsManager", controller.address)

        let roundsManager

        if (!lpDeployer.isLiveNetwork(network)) {
            // Only deploy the adjustable rounds manager contract if we are in an isolated testing environment and not a live network
            roundsManager = await lpDeployer.deployProxyAndRegister(AdjustableRoundsManager, "RoundsManager", controller.address)
        } else {
            roundsManager = await lpDeployer.deployProxyAndRegister(RoundsManager, "RoundsManager", controller.address)
        }

        await lpDeployer.deployProxyAndRegister(ServiceRegistry, "ServiceRegistry", controller.address)

        deployer.logger.log("Initializing contracts...")

        // Set BondingManager parameters
        await bondingManager.setUnbondingPeriod(config.bondingManager.unbondingPeriod)
        await bondingManager.setNumTranscoders(config.bondingManager.numTranscoders)
        await bondingManager.setNumActiveTranscoders(config.bondingManager.numActiveTranscoders)
        await bondingManager.setMaxEarningsClaimsRounds(config.bondingManager.maxEarningsClaimsRounds)

        // Set JobsManager parameters
        await jobsManager.setVerificationRate(config.jobsManager.verificationRate)
        await jobsManager.setVerificationPeriod(config.jobsManager.verificationPeriod)
        await jobsManager.setVerificationSlashingPeriod(config.jobsManager.verificationSlashingPeriod)
        await jobsManager.setFailedVerificationSlashAmount(config.jobsManager.failedVerificationSlashAmount)
        await jobsManager.setMissedVerificationSlashAmount(config.jobsManager.missedVerificationSlashAmount)
        await jobsManager.setDoubleClaimSegmentSlashAmount(config.jobsManager.doubleClaimSegmentSlashAmount)
        await jobsManager.setFinderFee(config.jobsManager.finderFee)

        // Set RoundsManager parameters
        await roundsManager.setRoundLength(config.roundsManager.roundLength)
        await roundsManager.setRoundLockAmount(config.roundsManager.roundLockAmount)
    })
}
