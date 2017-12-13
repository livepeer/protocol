const config = require("./migrations.config.js")
const BigNumber = require("bignumber.js")
const {contractId} = require("../utils/helpers")

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

const deploy = async (deployer, artifact, ...args) => {
    await deployer.deploy(artifact, ...args)
    return await artifact.deployed()
}

const deployAndRegister = async (deployer, controller, artifact, name, ...args) => {
    const contract = await deploy(deployer, artifact, ...args)
    await controller.setContract(contractId(name), contract.address)
    return contract
}

const deployProxyAndRegister = async (deployer, controller, targetArtifact, name, ...args) => {
    deployer.logger.log("Deploying proxy for " + name + "...")

    const targetName = name + "Target"

    const target = await deployAndRegister(deployer, controller, targetArtifact, targetName, ...args)
    deployer.logger.log("Target contract for " + name + ": " + target.address)

    const proxy = await ManagerProxy.new(controller.address, contractId(targetName))
    deployer.logger.log("Proxy contract for " + name + ": " + proxy.address)

    await controller.setContract(contractId(name), proxy.address)

    return await targetArtifact.at(proxy.address)
}

module.exports = function(deployer, network) {
    deployer.then(async () => {
        const controller = await deploy(deployer, Controller)

        const token = await deployAndRegister(deployer, controller, LivepeerToken, "LivepeerToken")
        const minter = await deployAndRegister(
            deployer,
            controller,
            Minter,
            "Minter",
            controller.address,
            config.minter.inflation,
            config.minter.inflationChange,
            config.minter.targetBondingRate
        )

        if (network === "development" || network === "testrpc" || network === "parityDev" || network === "gethDev") {
            await deployAndRegister(deployer, controller, IdentityVerifier, "Verifier", controller.address)
        } else if (network === "lpTestNet") {
            await deployAndRegister(deployer, controller, LivepeerVerifier, "Verifier", controller.address, config.verifier.solvers, config.verifier.verificationCodeHash)
        } else {
            await deployAndRegister(deployer, controller, OraclizeVerifier, "Verifier", controller.address, config.verifier.verificationCodeHash, config.verifier.gasPrice, config.verifier.gasLimit)
        }

        if (network === "development" || network === "testrpc" || network === "parityDev" || network == "gethDev" || network === "lpTestNet") {
            const faucet = await deployAndRegister(deployer, controller, LivepeerTokenFaucet, "LivepeerTokenFaucet", token.address, config.faucet.requestAmount, config.faucet.requestWait)

            await token.mint(faucet.address, new BigNumber(config.faucet.faucetAmount))

            await Promise.all(config.faucet.whitelist.map(addr => {
                return faucet.addToWhitelist(addr)
            }))
        }

        const bondingManager = await deployProxyAndRegister(deployer, controller, BondingManager, "BondingManager", controller.address)
        const jobsManager = await deployProxyAndRegister(deployer, controller, JobsManager, "JobsManager", controller.address)

        let roundsManager

        if (network === "development" || network === "testrpc" || network === "parityDev" || network === "gethDev") {
            roundsManager = await deployProxyAndRegister(deployer, controller, AdjustableRoundsManager, "RoundsManager", controller.address)
        } else {
            roundsManager = await deployProxyAndRegister(deployer, controller, RoundsManager, "RoundsManager", controller.address)
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

        deployer.logger.log("Transferring ownership of the LivepeerToken to the Minter...")

        await token.transferOwnership(minter.address)

        deployer.logger.log("Unpausing the Controller...")

        await controller.unpause()
    })
}
