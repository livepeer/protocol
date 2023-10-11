import {HardhatRuntimeEnvironment} from "hardhat/types"
import {DeployFunction} from "hardhat-deploy/types"

import ContractDeployer from "../utils/deployer"
import {ethers} from "hardhat"
import {RoundsManager} from "../typechain"
import {contractId} from "../utils/helpers"

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
    const {deployments, getNamedAccounts} = hre // Get the deployments and getNamedAccounts which are provided by hardhat-deploy

    const {deployer} = await getNamedAccounts() // Fetch named accounts from hardhat.config.ts

    const contractDeployer = new ContractDeployer(deployer, deployments)
    const controller = await contractDeployer.fetchDeployedController()

    const RoundsManager: RoundsManager = await ethers.getContractAt(
        "RoundsManager",
        await deployments.get("RoundsManager").then(c => c.address)
    )
    const blockNum = await RoundsManager.blockNum()

    const roundsManager = await contractDeployer.deploy({
        contract: "AdjustableRoundsManager",
        name: "RoundsManagerTarget",
        args: [controller.address],
        proxy: false // we're deploying the target directly
    })

    console.log("Run governance update for rounds manager:", {
        contractId: contractId("RoundsManagerTarget"),
        address: roundsManager.address,
        gitCommitHash: await contractDeployer.getGitHeadCommitHash(),
        blockNum
    })
}

func.tags = ["ADJUSTABLE_ROUNDS_MANAGER"]
export default func
