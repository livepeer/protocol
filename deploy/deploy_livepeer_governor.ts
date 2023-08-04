import {constants} from "ethers"
import {ethers} from "hardhat"
import {HardhatRuntimeEnvironment} from "hardhat/types"
import {DeployFunction} from "hardhat-deploy/types"

import ContractDeployer from "../utils/deployer"
import {LivepeerGovernor, Treasury} from "../typechain"
import getNetworkConfig from "./migrations.config"

const PROD_NETWORKS = ["mainnet", "arbitrumMainnet"]

const isProdNetwork = (name: string): boolean => {
    return PROD_NETWORKS.indexOf(name) > -1
}

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
    const {deployments, getNamedAccounts} = hre // Get the deployments and getNamedAccounts which are provided by hardhat-deploy
    const {deploy, get} = deployments // the deployments object itself contains the deploy function

    const {deployer} = await getNamedAccounts() // Fetch named accounts from hardhat.config.ts

    const config = getNetworkConfig(hre.network.name)

    const contractDeployer = new ContractDeployer(deploy, deployer, deployments)
    const controller = await contractDeployer.fetchDeployedController()

    // PollCreator is deployed without being registered to Controller, so we do that here
    const registeredPollCreator = await controller.getContract(
        ethers.utils.solidityKeccak256(["string"], ["PollCreator"])
    )
    if (registeredPollCreator === constants.AddressZero) {
        const pollCreator = await ethers.getContractAt(
            "PollCreator",
            isProdNetwork(hre.network.name) ?
                config.livepeerGovernor.pollCreatorAddress :
                await get("PollCreator").then(p => p.address)
        )

        await contractDeployer.register("PollCreator", pollCreator.address)
    }

    await contractDeployer.deployAndRegister({
        contract: "BondingCheckpointsVotes",
        name: "BondingCheckpointsVotes",
        args: [controller.address]
    })

    // Onchain treasury governor (LivepeerGovernor)
    const treasury = await contractDeployer.deployAndRegister({
        contract: "Treasury",
        name: "Treasury",
        args: []
    })
    const Treasury: Treasury = await ethers.getContractAt(
        "Treasury",
        treasury.address
    )

    await Treasury.initialize(
        config.treasury.minDelay,
        [], // governor will be added as a proposer later
        [constants.AddressZero], // let anyone execute proposals
        deployer // temporary admin role for deployer
    ).then(tx => tx.wait())

    const livepeerGovernor = await contractDeployer.deployAndRegister({
        contract: "LivepeerGovernor",
        name: "LivepeerGovernor",
        args: [controller.address],
        proxy: true
    })
    const LivepeerGovernor: LivepeerGovernor = await ethers.getContractAt(
        "LivepeerGovernor",
        livepeerGovernor.address
    )

    await LivepeerGovernor.initialize(
        config.livepeerGovernor.initialVotingDelay,
        config.livepeerGovernor.initialVotingPeriod,
        config.livepeerGovernor.initialProposalThreshold
    ).then(tx => tx.wait())

    // Now grant proposer and executor roles to governor and renounce deployer admin role
    const roles = {
        proposer: await Treasury.PROPOSER_ROLE(),
        canceller: await Treasury.CANCELLER_ROLE(),
        executor: await Treasury.EXECUTOR_ROLE(),
        admin: await Treasury.TIMELOCK_ADMIN_ROLE()
    }
    for (const role of [roles.proposer, roles.canceller, roles.executor]) {
        await Treasury.grantRole(role, LivepeerGovernor.address).then(tx =>
            tx.wait()
        )
    }

    if (isProdNetwork(hre.network.name)) {
        // TODO: Make sure we really want this. Multi-sig would have root to everything
        await Treasury.grantRole(roles.admin, config.governor.owner).then(tx =>
            tx.wait()
        )
    }
    await Treasury.renounceRole(roles.admin, deployer).then(tx => tx.wait())
}

func.dependencies = ["Contracts", "Poll"]
func.tags = ["LivepeerGovernor"]
export default func
