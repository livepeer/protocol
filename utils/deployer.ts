import util from "util"
import childProcess from "child_process"
const exec = util.promisify(childProcess.exec)

import {ethers} from "hardhat"
import {DeployResult, DeploymentsExtension} from "hardhat-deploy/types"
import {deployments} from "hardhat"
import {Controller} from "../typechain"
import {Libraries} from "hardhat/types"

export type DeployConfig = {
    contract: string
    name: string
    proxy?: boolean
    args: Array<any>
    libraries?: Libraries | undefined
}

export default class ContractDeployer {
    deployer: string
    deployments: DeploymentsExtension
    controller: Controller | undefined

    constructor(deployer: string, deployments: DeploymentsExtension) {
        this.deployer = deployer
        this.deployments = deployments
        this.controller = undefined
    }

    async getGitHeadCommitHash(): Promise<string> {
        const {stdout, stderr} = await exec("git rev-parse HEAD")
        if (stderr) {
            throw new Error(stderr)
        }
        return `0x${stdout?.trim()}`
    }

    private contractId(name: string) {
        return ethers.utils.solidityKeccak256(["string"], [name])
    }

    async deployController(): Promise<Controller> {
        if (this.controller && (await deployments.get("Controller"))) {
            console.log("Controller already deployed")
        } else {
            const {deploy} = this.deployments // the deployments object itself contains the deploy function

            const controller = await deploy("Controller", {
                from: this.deployer, // msg.sender overwrite, use named account
                args: [], // constructor arguments
                log: true // display the address and gas used in the console (not when run in test though)
            })
            this.controller = (await ethers.getContractAt(
                "Controller",
                controller.address
            )) as Controller
        }
        return this.controller
    }

    async fetchDeployedController(): Promise<Controller> {
        const deployment = await this.deployments.get("Controller")
        this.controller = (await ethers.getContractAt(
            "Controller",
            deployment.address
        )) as Controller
        return this.controller
    }

    async deployAndRegister(config: DeployConfig): Promise<DeployResult> {
        const {name, proxy} = config

        if (!this.controller) {
            throw new Error("Controller not initialized for registration")
        }

        const deploy = await this.deploy(config)

        if (proxy) {
            // deploy function only returns the proxy deployment in this case, so fetch the deployed target info
            const targetName = `${name}Target`
            const target = await this.deployments.get(targetName)
            if (!target) {
                throw new Error(`${targetName} not found`)
            }

            // target has to be registered with a Target suffix
            await this.register(targetName, target.address)
        }

        // proxy gets registered as the actual contract name
        await this.register(name, deploy.address)

        return deploy
    }

    async deploy(config: DeployConfig) {
        const {contract, name, proxy, args, libraries} = config
        const {deploy} = this.deployments // the deployments object itself contains the deploy function

        // if there's no proxy, the target is just the contract itself
        const targetName = proxy ? `${name}Target` : name
        const target = await deploy(targetName, {
            contract,
            from: this.deployer,
            log: true,
            args: [...args],
            libraries: libraries
        })

        if (!proxy) {
            return target
        }
        if (!this.controller) {
            throw new Error("Controller not initialized for proxy deploy")
        }

        // proxy == true, proceed with proxy deployment and registration as the actual contract `name`
        const managerProxy = await deploy(name, {
            contract: "ManagerProxy",
            from: this.deployer,
            log: true,
            args: [this.controller.address, this.contractId(targetName)]
        })

        // additionally, save the proxy deployment with a "Proxy" suffix
        await deployments.save(`${name}Proxy`, managerProxy)

        return managerProxy
    }

    async register(name: string, address: string) {
        const gitHash = await this.getGitHeadCommitHash()
        await (
            await this.controller?.setContractInfo(
                this.contractId(name),
                address,
                gitHash
            )
        )?.wait()
    }
}
