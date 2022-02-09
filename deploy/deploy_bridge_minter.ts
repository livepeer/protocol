import {HardhatRuntimeEnvironment} from "hardhat/types"
import {DeployFunction} from "hardhat-deploy/types"
import getNetworkConfig from "./migrations.config"

const func: DeployFunction = async function(hre: HardhatRuntimeEnvironment) {
    const {deployments, getNamedAccounts} = hre
    const {deploy} = deployments

    const {deployer} = await getNamedAccounts()

    const config = getNetworkConfig(hre.network.name)

    await deploy("BridgeMinter", {
        from: deployer,
        log: true,
        args: [
            config.bridgeMinter.controller,
            config.bridgeMinter.l1Migrator,
            config.bridgeMinter.l1LPTGateway
        ]
    })
}

func.tags = ["BRIDGE_MINTER"]
export default func
