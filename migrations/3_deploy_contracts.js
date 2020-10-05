const config = require("./migrations.config.js")
const ContractDeployer = require("../utils/contractDeployer")

const Controller = artifacts.require("Controller")
const Minter = artifacts.require("Minter")
const ServiceRegistry = artifacts.require("ServiceRegistry")
const BondingManager = artifacts.require("BondingManager.sol")
const RoundsManager = artifacts.require("RoundsManager")
const AdjustableRoundsManager = artifacts.require("AdjustableRoundsManager")
const TicketBroker = artifacts.require("TicketBroker")
const LivepeerToken = artifacts.require("LivepeerToken")
const LivepeerTokenFaucet = artifacts.require("LivepeerTokenFaucet")
const ManagerProxy = artifacts.require("ManagerProxy")
const MerkleSnapshot = artifacts.require("MerkleSnapshot")

module.exports = function(deployer, network) {
    if (network === "unitTest") {
        return
    }

    deployer.then(async () => {
        const lpDeployer = new ContractDeployer(deployer, Controller, ManagerProxy)

        const controller = await lpDeployer.deployController()
        const token = await lpDeployer.deployAndRegister(LivepeerToken, "LivepeerToken")
        await lpDeployer.deployAndRegister(Minter, "Minter", controller.address, config.minter.inflation, config.minter.inflationChange, config.minter.targetBondingRate)

        if (!lpDeployer.isProduction(network)) {
            // Only deploy a faucet if not in production
            await lpDeployer.deployAndRegister(LivepeerTokenFaucet, "LivepeerTokenFaucet", token.address, config.faucet.requestAmount, config.faucet.requestWait)
        }

        const broker = await lpDeployer.deployProxyAndRegister(
            TicketBroker,
            "TicketBroker",
            controller.address
        )
        // Register TicketBroker with JobsManager contract ID because in a production system the Minter likely will not be upgraded to be
        // aware of the TicketBroker contract ID and it will only be aware of the JobsManager contract ID
        await lpDeployer.register("JobsManager", broker.address)

        const bondingManager = await lpDeployer.deployProxyAndRegister(BondingManager, "BondingManager", controller.address)

        let roundsManager

        if (!lpDeployer.isLiveNetwork(network)) {
            // Only deploy the adjustable rounds manager contract if we are in an isolated testing environment and not a live network
            roundsManager = await lpDeployer.deployProxyAndRegister(AdjustableRoundsManager, "RoundsManager", controller.address)
        } else {
            roundsManager = await lpDeployer.deployProxyAndRegister(RoundsManager, "RoundsManager", controller.address)
        }

        await lpDeployer.deployProxyAndRegister(ServiceRegistry, "ServiceRegistry", controller.address)

        await lpDeployer.deployAndRegister(MerkleSnapshot, "MerkleSnapshot", controller.address)

        deployer.logger.log("Initializing contracts...")

        // Set BondingManager parameters
        await bondingManager.setUnbondingPeriod(config.bondingManager.unbondingPeriod)
        await bondingManager.setNumActiveTranscoders(config.bondingManager.numActiveTranscoders)
        await bondingManager.setMaxEarningsClaimsRounds(config.bondingManager.maxEarningsClaimsRounds)

        // Set RoundsManager parameters
        await roundsManager.setRoundLength(config.roundsManager.roundLength)
        await roundsManager.setRoundLockAmount(config.roundsManager.roundLockAmount)

        // Set TicketBroker parameters
        await broker.setUnlockPeriod(config.broker.unlockPeriod)
        await broker.setTicketValidityPeriod(config.broker.ticketValidityPeriod)
    })
}
