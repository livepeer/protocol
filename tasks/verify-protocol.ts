import {task} from "hardhat/config"
import {HardhatRuntimeEnvironment} from "hardhat/types"
import {ethers} from "ethers"
import getNetworkConfig from "../deploy/migrations.config"

import {
    BondingManager,
    Controller as ControllerContract,
    Governor,
    Minter,
    RoundsManager,
    TicketBroker
} from "../typechain"

const BridgeContracts = {
    L2Migrator: "0x148D5b6B4df9530c7C76A810bd1Cdf69EC4c2085",
    L2MigratorTarget: "0x4F59b39e2ea628fe8371BDfd51B063319339c7EE",
    L2LPTDataCache: "0xd78b6bD09cd28A83cFb21aFa0DA95c685A6bb0B1"
}

class Controller {
    public controller: ControllerContract
    public deployments: any

    constructor(controller: ControllerContract, deployments: any) {
        this.controller = controller
        this.deployments = deployments
    }

    get address() {
        return this.controller.address
    }

    static async new(hre: HardhatRuntimeEnvironment) {
        // @ts-ignore
        const {deployments, ethers} = hre
        const controllerDeployment = await deployments.get("Controller")
        const controller: ControllerContract = await ethers.getContractAt(
            "Controller",
            controllerDeployment.address
        )

        return new Controller(controller, deployments)
    }

    static getContractId(name: string) {
        return ethers.utils.solidityKeccak256(["string"], [name])
    }

    async getContractAddr(name: string) {
        return this.controller.getContract(Controller.getContractId(name))
    }

    async verifyRegisteredContract(name: string) {
        const registeredAddress = await this.getContractAddr(name)

        let deployedAddress: string
        if (name === "L2Migrator") {
            deployedAddress = BridgeContracts.L2Migrator
        } else if (name === "L2MigratorTarget") {
            deployedAddress = BridgeContracts.L2MigratorTarget
        } else if (name === "L2LPTDataCache") {
            deployedAddress = BridgeContracts.L2LPTDataCache
        } else {
            deployedAddress = (await this.deployments.get(name)).address
        }

        this.expectMatch(name, registeredAddress, deployedAddress)
    }

    private expectMatch(
        name: string,
        registeredAddr: string,
        deployedAddr: string
    ) {
        const checksum = ethers.utils.getAddress
        if (checksum(registeredAddr) === checksum(deployedAddr)) {
            console.log(`\x1b[32m${registeredAddr}\x1b[0m - ${name} ✅`)
        } else {
            console.log(
                `${name}: deployed at \x1b[32m${deployedAddr}\x1b[0m but registered at \x1b[31m${registeredAddr}\x1b[0m ❌`
            )
        }
    }
}

async function assertEqual(name: string, actual: any, expected: any) {
    if (ethers.BigNumber.from(actual).eq(ethers.BigNumber.from(expected))) {
        console.log(`\x1b[33m${name}\x1b[0m : ${actual} ✅`)
    } else {
        console.log(
            `expected value for ${name}: \x1b[32m${expected}\x1b[0m but received \x1b[31m${actual} ❌\x1b[0m`
        )
    }
}

task(
    "verify-protocol",
    "Verifies addresses and params for deployed protocol contracts"
).setAction(async (_, hre: HardhatRuntimeEnvironment) => {
    const {deployments, ethers} = hre

    const controller = await Controller.new(hre)

    const protocolContracts = [
        "Minter",
        "BondingManager",
        "BondingManagerTarget",
        "TicketBroker",
        "TicketBrokerTarget",
        "RoundsManager",
        "RoundsManagerTarget",
        "ServiceRegistry",
        "ServiceRegistryTarget",
        "MerkleSnapshot",
        "L2Migrator",
        "L2MigratorTarget",
        "L2LPTDataCache"
    ]

    await Promise.all(
        protocolContracts.map(contract =>
            controller.verifyRegisteredContract(contract)
        )
    )

    const config = getNetworkConfig(hre.network.name)

    // Check Controller params
    assertEqual(
        "Controller:owner",
        await controller.controller.owner(),
        config.governor.owner
    )

    // Check Governor params
    const governorDeployment = await deployments.get("Governor")
    const governor: Governor = await ethers.getContractAt(
        "Governor",
        governorDeployment.address
    )

    assertEqual("Governor:owner", await governor.owner(), config.governor.owner)

    // Check BondingManager params
    const bondingManager: BondingManager = await ethers.getContractAt(
        "BondingManager",
        await controller.getContractAddr("BondingManager")
    )

    assertEqual(
        "BondingManager:unbondingPeriod",
        await bondingManager.unbondingPeriod(),
        config.bondingManager.unbondingPeriod
    )

    assertEqual(
        "BondingManager:numActiveTranscoders",
        await bondingManager.getTranscoderPoolMaxSize(),
        config.bondingManager.numActiveTranscoders
    )

    // Check ticketBroker params
    const ticketBroker: TicketBroker = await ethers.getContractAt(
        "TicketBroker",
        await controller.getContractAddr("TicketBroker")
    )

    assertEqual(
        "TicketBroker:unlockPeriod",
        await ticketBroker.unlockPeriod(),
        config.broker.unlockPeriod
    )

    assertEqual(
        "TicketBroker:ticketValidityPeriod",
        await ticketBroker.ticketValidityPeriod(),
        config.broker.ticketValidityPeriod
    )

    // Check RoundsManager params
    const roundsManager: RoundsManager = await ethers.getContractAt(
        "RoundsManager",
        await controller.getContractAddr("RoundsManager")
    )

    assertEqual(
        "RoundsManager:roundLength",
        await roundsManager.roundLength(),
        config.roundsManager.roundLength
    )
    assertEqual(
        "RoundsManager:roundLockAmount",
        await roundsManager.roundLockAmount(),
        config.roundsManager.roundLockAmount
    )

    // Check Minter params
    const minter: Minter = await ethers.getContractAt(
        "Minter",
        await controller.getContractAddr("Minter")
    )

    assertEqual(
        "Minter:inflation",
        await minter.inflation(),
        config.minter.inflation
    )
    assertEqual(
        "Minter:inflationChange",
        await minter.inflationChange(),
        config.minter.inflationChange
    )
    assertEqual(
        "Minter:targetBondingRate",
        await minter.targetBondingRate(),
        config.minter.targetBondingRate
    )
})
