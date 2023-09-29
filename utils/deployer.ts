import util from "util"
import childProcess from "child_process"
const exec = util.promisify(childProcess.exec)

import {ethers} from "hardhat"
import {
    DeployOptions,
    DeployResult,
    DeploymentsExtension
} from "hardhat-deploy/types"
import {deployments} from "hardhat"
import {Controller} from "../typechain"
import {Libraries} from "hardhat/types"

export default class ContractDeployer {
    deploy: (name: string, options: DeployOptions) => Promise<DeployResult>
    deployer: string
    deployments: DeploymentsExtension
    controller: Controller | undefined

    /**
     * skipRegister is used to skip the registration on the protocol controller (`setContractInfo`) of contracts
     * deployed with this deployer instance. It is used when the deployer account is not the controller owner, which is
     * the case in prod networks. In production, the registration has to be done through proceeding governance actions.
     */
    readonly skipRegister: boolean

    constructor(
        deploy: (name: string, options: DeployOptions) => Promise<DeployResult>,
        deployer: string,
        deployments: DeploymentsExtension,
        skipRegister = false
    ) {
        this.deploy = deploy
        this.deployer = deployer
        this.deployments = deployments
        this.controller = undefined
        this.skipRegister = skipRegister
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

    async deployController(): Promise<Controller> {
        if (this.controller && (await deployments.get("Controller"))) {
            console.log("Controller already deployed")
        } else {
            const controller = await this.deploy("Controller", {
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

    async deployAndRegister(config: {
        contract: string
        name: string
        proxy?: boolean
        args: Array<any>
        libraries?: Libraries | undefined
    }): Promise<DeployResult> {
        const {contract, name, proxy, args, libraries} = config

        const shouldRegister = this.controller && !this.skipRegister
        const gitHash = await this.getGitHeadCommitHash()

        // if there's no proxy, the target is just the contract itself
        const targetName = proxy ? `${name}Target` : name
        const target = await this.deploy(targetName, {
            contract,
            from: this.deployer,
            log: true,
            args: [...args],
            libraries: libraries
        })
        if (shouldRegister) {
            await this.controller!.setContractInfo(
                this.contractId(targetName),
                target.address,
                gitHash
            ).then(tx => tx.wait())
        }

        if (!proxy) {
            return target
        }
        if (!this.controller) {
            throw new Error("Controller not initialized for proxy deploy")
        }

        // proxy == true, proceed with proxy deployment and registration as the actual contract `name`
        const managerProxy = await this.deploy(name, {
            contract: "ManagerProxy",
            from: this.deployer,
            log: true,
            args: [this.controller?.address, this.contractId(targetName)]
        })

        if (shouldRegister) {
            await this.controller
                .setContractInfo(
                    this.contractId(name),
                    managerProxy.address,
                    gitHash
                )
                .then(tx => tx.wait())
        }

        // additionally, save the proxy deployment with a "Proxy" suffix
        await deployments.save(`${name}Proxy`, managerProxy)

        return managerProxy
    }
}
