import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { ethers } from 'hardhat'

import { Controller, BondingManager, RoundsManager, TicketBroker } from '../typechain'

import ContractDeployer from './deployer'
import config from './migrations.config'
import { Contract } from '@ethersproject/contracts'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre // Get the deployments and getNamedAccounts which are provided by hardhat-deploy
    const { deploy } = deployments // the deployments object itself contains the deploy function
  
    const { deployer } = await getNamedAccounts() // Fetch named accounts from hardhat.config.ts

    const contractDeployer = new ContractDeployer(
        deploy, deployer, deployments
    )

    const Controller: Controller = await contractDeployer.deployController()

    const livepeerToken = await contractDeployer.deployAndRegister({
        contract: "LivepeerToken",
        name: "LivepeerToken",
        args: []
    })
    
    const minter = await contractDeployer.deployAndRegister({
        contract: "Minter",
        name: "Minter",
        args: [Controller.address, config.minter.inflation, config.minter.inflationChange, config.minter.targetBondingRate]
    })

    // ticket broker
    const ticketBroker = await contractDeployer.deployAndRegister({
        contract: "TicketBroker",
        name: "JobsManager",
        proxy: true,
        args: [Controller.address]
    })

    // bonding manager
    const sortedDoublyLL = await deploy("SortedDoublyLL", {
        from: deployer, 
        log: true
    })

    const bondingManager = await contractDeployer.deployAndRegister({
        contract: "BondingManager",
        name: "BondingManager",
        proxy: true,
        libraries: {
            SortedDoublyLL: sortedDoublyLL.address
        },
        args: [Controller.address]
    })
   
    // rounds manager
    let roundsManager
    if (hre.network.name !== 'mainnet') {
        roundsManager = await contractDeployer.deployAndRegister({
            contract: "AdjustableRoundsManager",
            name: "RoundsManager",
            proxy: true,
            args: [Controller.address]
        })
    } else {
        roundsManager = await contractDeployer.deployAndRegister({
            contract: "RoundsManager",
            name: "RoundsManager",
            proxy: true,
            args: [Controller.address]
        })
    }

    // service registry 
    const serviceRegistry = await contractDeployer.deployAndRegister({
        contract: "ServiceRegistry",
        name: "ServiceRegistry",
        args: [Controller.address],
    })
   
    // merkle snapshot
    const merkleSnapshot = await contractDeployer.deployAndRegister({
        contract: "MerkleSnapshot",
        name: "MerkleSnapshot",
        args: [Controller.address]
    })
 
    // Set BondingManager parameters
    const BondingManager: BondingManager = (await ethers.getContractAt("BondingManager", bondingManager.address)) as BondingManager

    console.log("** Setting BondingManager parameters **")
    await BondingManager.setUnbondingPeriod(config.bondingManager.unbondingPeriod)
    await BondingManager.setNumActiveTranscoders(config.bondingManager.numActiveTranscoders)
    await BondingManager.setMaxEarningsClaimsRounds(config.bondingManager.maxEarningsClaimsRounds)

    // Set RoundsManager parameters
    console.log("** Setting RoundsManager parameters **")
    const RoundsManager: RoundsManager = (await ethers.getContractAt("RoundsManager", roundsManager.address)) as RoundsManager
    await RoundsManager.setRoundLength(config.roundsManager.roundLength)
    await RoundsManager.setRoundLockAmount(config.roundsManager.roundLockAmount)

    // Set TicketBroker parameters
    console.log("** Setting TicketBroker parameters **")
    const Broker: TicketBroker = (await ethers.getContractAt("TicketBroker", ticketBroker.address)) as TicketBroker
    await Broker.setUnlockPeriod(config.broker.unlockPeriod)
    await Broker.setTicketValidityPeriod(config.broker.ticketValidityPeriod)
}

func.tags = ["Contracts"]
export default func 