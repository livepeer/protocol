const genesis = require("./genesis.config.js")
const BigNumber = require("bignumber.js")
const ContractDeployer = require("../utils/contractDeployer")
const {contractId} = require("../utils/helpers")

const Controller = artifacts.require("Controller")
const ManagerProxy = artifacts.require("ManagerProxy")
const LivepeerToken = artifacts.require("LivepeerToken")
const GenesisManager = artifacts.require("GenesisManager")
const MerkleMine = artifacts.require("MerkleMine")

const getCurrentBlock = async () => {
    return await new Promise((resolve, reject) => {
        return web3.eth.getBlock("latest", (err, blk) => {
            if (err) {
                reject(err)
            } else {
                resolve(blk)
            }
        })
    })
}

module.exports = function(deployer, network, accounts) {
    deployer.then(async () => {
        const lpDeployer = new ContractDeployer(deployer, Controller, ManagerProxy)

        const controller = await Controller.deployed()
        const tokenAddr = await controller.getContract(contractId("LivepeerToken"))
        const minterAddr = await controller.getContract(contractId("Minter"))
        const token = await LivepeerToken.at(tokenAddr)

        let genesisManager

        const currentTimestamp = new BigNumber((await getCurrentBlock()).timestamp)
        const grantsStartTimestamp = currentTimestamp.plus(genesis.timeToGrantsStart)

        if (!lpDeployer.isProduction(network)) {
            // If not in production, send the crowd supply to the faucet and the company supply to the deployment account
            deployer.logger.log("Not in production - crowd supply will be sent to faucet and company supply will be sent to deployment account")

            const faucetAddr = await controller.getContract(contractId("LivepeerTokenFaucet"))
            genesisManager = await lpDeployer.deploy(GenesisManager, tokenAddr, faucetAddr, accounts[0], minterAddr, grantsStartTimestamp)
        } else {
            // If in production, send the crowd supply to the token distribution contract and the company supply to the bank multisig
            deployer.logger.log("In production - crowd supply will be sent to token distribution contract and company supply will be sent to bank multisig")

            const currentBlockNum = (await getCurrentBlock()).number
            const callerAllocationStartBlock = currentBlockNum + genesis.merkleMine.blocksToCliff
            const callerAllocationEndBlock = callerAllocationStartBlock + genesis.merkleMine.callerAllocationPeriod

            const merkleMine = await lpDeployer.deploy(
                MerkleMine,
                tokenAddr,
                genesis.merkleMine.genesisRoot,
                genesis.crowdSupply,
                genesis.merkleMine.totalGenesisRecipients,
                genesis.merkleMine.balanceThreshold,
                genesis.merkleMine.genesisBlock,
                callerAllocationStartBlock,
                callerAllocationEndBlock
            )
            genesisManager = await lpDeployer.deploy(GenesisManager, tokenAddr, merkleMine.address, genesis.bankMultisig, minterAddr, grantsStartTimestamp)
        }

        deployer.logger.log("Transferring ownership of the LivepeerToken to the GenesisManager...")

        await token.transferOwnership(genesisManager.address)

        deployer.logger.log("Setting genesis token allocations...")

        await genesisManager.setAllocations(
            genesis.initialSupply,
            genesis.crowdSupply,
            genesis.companySupply,
            genesis.teamSupply,
            genesis.investorsSupply,
            genesis.communitySupply
        )

        deployer.logger.log("Starting genesis...")

        await genesisManager.start()

        deployer.logger.log("Adding team token grants...")

        for (let grant of genesis.teamGrants) {
            await genesisManager.addTeamGrant(grant.receiver, grant.amount, genesis.teamTimeToCliff, genesis.teamVestingDuration)
        }

        deployer.logger.log("Adding investor token grants...")

        for (let grant of genesis.investorGrants) {
            await genesisManager.addInvestorGrant(grant.receiver, grant.amount, genesis.investorsTimeToCliff, genesis.investorsVestingDuration)
        }

        deployer.logger.log("Adding community token grants...")

        for (let grant of genesis.communityGrants) {
            await genesisManager.addCommunityGrant(grant.receiver, grant.amount)
        }

        deployer.logger.log("Ending genesis and transferring ownership of the LivepeerToken to the protocol Minter...")

        await genesisManager.end()

        if (lpDeployer.isProduction(network)) {
            // If in production, start generation period
            deployer.logger.log("In production - starting generation period")
            const merkleMine = await MerkleMine.deployed()
            await merkleMine.start()

            // If in production, transfer ownership of the Controller to the governance multisig
            deployer.logger.log(`In production - transferring ownership of the Controller at ${controller.address} to the governance multisig ${genesis.governanceMultisig}`)

            await controller.transferOwnership(genesis.governanceMultisig)

            const newOwner = await controller.owner()
            deployer.logger.log(`Controller at ${controller.address} is now owned by ${newOwner}`)
        }
    })
}
