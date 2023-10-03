import {Address} from "hardhat-deploy/types"
import {Etherscan} from "@nomicfoundation/hardhat-verify/etherscan"
import {task} from "hardhat/config"
import https from "https"
import {HardhatRuntimeEnvironment} from "hardhat/types"

task(
    "etherscan-verify-deployments",
    "Verifies all contracts in the deployments folder"
).setAction(async (taskArgs, hre) => {
    const etherscan = await etherscanClient(hre)
    const deployments = Object.entries(await hre.deployments.all())

    console.log(`Read ${deployments.length} deployments from environment`)

    for (const [name, deployment] of deployments) {
        console.log() // newline

        const address = deployment.address
        const constructorArguments = deployment.args

        console.log(
            `Verifying ${name} at ${address} constructed with (${constructorArguments})`
        )
        await hre.run("verify:verify", {address, constructorArguments})

        if (name.endsWith("Proxy") && name !== "ManagerProxy") {
            const targetName = name.replace("Proxy", "Target")
            const target = await hre.deployments.get(targetName)

            console.log(
                `Verifying as proxy to ${targetName} at ${target.address}`
            )
            await verifyProxyContract(etherscan, address, target.address)
        }
    }
})

async function etherscanClient({config, network}: HardhatRuntimeEnvironment) {
    const apiKey = config.etherscan.apiKey
    const chainConfig = await Etherscan.getCurrentChainConfig(
        network.name,
        network.provider,
        []
    )
    return Etherscan.fromChainConfig(apiKey, chainConfig)
}

function verifyProxyContract(
    etherscan: Etherscan,
    proxyAddress: Address,
    targetAddress: Address
) {
    const url = new URL(etherscan.apiUrl)
    if (url.protocol !== "https:") {
        throw new Error("Etherscan API URL must use HTTPS")
    }

    const options = {
        hostname: url.hostname,
        path:
            url.pathname +
            `?module=contract&action=verifyproxycontract&address=${proxyAddress}` +
            `&expectedimplementation=${targetAddress}&apikey=${etherscan.apiKey}`,
        method: "GET"
    }

    return new Promise<void>((resolve, reject) => {
        const req = https.request(options, res => {
            if (res.statusCode === 200) {
                return resolve()
            }

            reject(
                new Error(
                    `Failed to verify proxy contract: ${res.statusCode} ${res.statusMessage}`
                )
            )
        })
        req.on("error", reject)
        req.end()
    })
}
