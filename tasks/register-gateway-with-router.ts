import {task} from "hardhat/config"
import {
    arbitrumBridgeContracts,
    getGasPriceBid,
    getMaxGas,
    getMaxSubmissionPrice,
    waitForTx,
    waitToRelayTxsToL2
} from "../utils/arbitrum"

task(
    "register-gateway-with-router",
    "Register gateway for LPT with GatewayRouter"
)
    .addParam("arbproviderurl", "Arbitrum provider URL")
    .addParam("gateway", "Gateway address")
    .setAction(async (taskArgs, hre) => {
        const {deployments, getNamedAccounts, ethers} = hre
        const {deployer} = await getNamedAccounts()

        const arbProvider = new ethers.providers.JsonRpcProvider(
            taskArgs.arbproviderurl
        )

        const tokenDeployment = await deployments.get("ArbitrumLivepeerToken")
        const token = await ethers.getContractAt(
            "ArbitrumLivepeerToken",
            tokenDeployment.address
        )

        const setGatewayABI = [
            "function setGateway(address[],address[]) external"
        ]
        const setGatewayCalldata = new ethers.utils.Interface(
            setGatewayABI
        ).encodeFunctionData("setGateway", [
            [token.address],
            [taskArgs.gateway]
        ])
        const gasPriceBid = await getGasPriceBid(arbProvider)
        const maxSubmissionCost = await getMaxSubmissionPrice(
            arbProvider,
            setGatewayCalldata
        )
        const maxGas = await getMaxGas(
            arbProvider,
            arbitrumBridgeContracts[hre.network.name].l1GatewayRouter,
            arbitrumBridgeContracts[hre.network.name].l2GatewayRouter,
            deployer,
            maxSubmissionCost,
            gasPriceBid,
            setGatewayCalldata
        )
        const ethValue = maxSubmissionCost.add(gasPriceBid.mul(maxGas))

        await waitToRelayTxsToL2(
            waitForTx(
                token.registerGatewayWithRouter(
                    taskArgs.gateway,
                    maxGas,
                    gasPriceBid,
                    maxSubmissionCost,
                    deployer,
                    {value: ethValue}
                )
            ),
            arbitrumBridgeContracts[hre.network.name].inbox,
            ethers.provider,
            arbProvider
        )
    })
