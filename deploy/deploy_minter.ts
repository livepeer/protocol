import {HardhatRuntimeEnvironment} from "hardhat/types"
import {DeployFunction} from "hardhat-deploy/types"
import {ethers} from "hardhat"
import {Minter} from "../typechain"

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
    const {deployments, getNamedAccounts} = hre // Get the deployments and getNamedAccounts which are provided by hardhat-deploy
    const {deploy} = deployments // the deployments object itself contains the deploy function

    const {deployer} = await getNamedAccounts() // Fetch named accounts from hardhat.config.ts

    const controllerDeployment = await deployments.get("Controller")
    const minterDeployment = await deployments.get("Minter")

    const minter: Minter = (await ethers.getContractAt(
        "Minter",
        minterDeployment.address
    )) as Minter

    const inflation = await minter.inflation()
    const inflationChange = await minter.inflationChange()
    const targetBondingRate = await minter.targetBondingRate()

    await deploy("Minter", {
        from: deployer,
        args: [
            controllerDeployment.address,
            inflation,
            inflationChange,
            targetBondingRate
        ]
    })
}

func.tags = ["Minter"]
export default func
