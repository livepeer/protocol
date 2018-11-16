const genesis = require("./genesis.config.js")
const ContractDeployer = require("../utils/contractDeployer")
const {contractId} = require("../utils/helpers")

const Controller = artifacts.require("Controller")
const ManagerProxy = artifacts.require("ManagerProxy")
const LivepeerToken = artifacts.require("LivepeerToken")

module.exports = function(deployer, network, accounts) {
    deployer.then(async () => {
        const lpDeployer = new ContractDeployer(deployer, Controller, ManagerProxy)

        const controller = await Controller.deployed()
        const tokenAddr = await controller.getContract(contractId("LivepeerToken"))
        const minterAddr = await controller.getContract(contractId("Minter"))
        const token = await LivepeerToken.at(tokenAddr)

        if (!lpDeployer.isProduction(network)) {
            // If not in production, send the crowd supply to the faucet and the company supply to the deployment account
            deployer.logger.log("Not in production - crowd supply will be sent to faucet and company supply will be sent to deployment account")

            const faucetAddr = await controller.getContract(contractId("LivepeerTokenFaucet"))
            await token.mint(faucetAddr, genesis.crowdSupply)

            await token.mint(accounts[0], genesis.companySupply)
        } 

        // TODO: Fill in additional allocation logic for testing purposes
        // This is not allocation logic used for mainnet

        deployer.logger.log("Transferring ownership of the LivepeerToken to the Minter...")

        await token.transferOwnership(minterAddr)

        if (lpDeployer.isProduction(network)) {
            // If in production, transfer ownership of the Controller to the governance multisig
            deployer.logger.log(`In production - transferring ownership of the Controller at ${controller.address} to the governance multisig ${genesis.governanceMultisig}`)

            await controller.transferOwnership(genesis.governanceMultisig)

            const newOwner = await controller.owner()
            deployer.logger.log(`Controller at ${controller.address} is now owned by ${newOwner}`)
        }
    })
}
