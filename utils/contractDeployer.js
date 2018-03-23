const util = require("util")
const exec = util.promisify(require("child_process").exec)
const {contractId} = require("./helpers")

class ContractDeployer {
    constructor(truffleDeployer, controllerArtifact, managerProxyArtifact) {
        this.truffleDeployer = truffleDeployer
        this.controllerArtifact = controllerArtifact
        this.managerProxyArtifact = managerProxyArtifact
    }

    async getGitHeadCommitHash() {
        const {stdout, stderr} = await exec("git rev-parse HEAD")
        if (stderr) throw new Error(stderr)
        return `0x${stdout.trim()}`
    }

    async deployController() {
        try {
            this.controller = await this.controllerArtifact.deployed()

            this.truffleDeployer.logger.log("Controller already deployed")
        } catch (e) {
            this.truffleDeployer.logger.log("Controller not yet deployed")

            this.controller = await this.deploy(this.controllerArtifact)
        }

        return this.controller
    }

    async deployAndRegister(artifact, name, ...args) {
        const contract = await this.deploy(artifact, ...args)
        const commitHash = await this.getGitHeadCommitHash()
        await this.controller.setContractInfo(contractId(name), contract.address, commitHash)
        return contract
    }

    async deployProxyAndRegister(targetArtifact, name, ...args) {
        this.truffleDeployer.logger.log(`Deploying proxy for ${name}...`)

        const targetName = `${name}Target`

        const target = await this.deployAndRegister(targetArtifact, targetName, ...args)
        this.truffleDeployer.logger.log(`Target contract for ${name}: ${target.address}`)

        const proxy = await this.managerProxyArtifact.new(this.controller.address, contractId(targetName))
        this.truffleDeployer.logger.log(`Proxy contract for ${name}: ${proxy.address}`)

        const commitHash = await this.getGitHeadCommitHash()
        await this.controller.setContractInfo(contractId(name), proxy.address, commitHash)

        return await targetArtifact.at(proxy.address)
    }

    async deploy(artifact, ...args) {
        await this.truffleDeployer.deploy(artifact, ...args)
        return await artifact.deployed()
    }

    isLiveNetwork(networkName) {
        return networkName === "mainnet" || networkName === "rinkebyDryRun" || networkName === "rinkeby" || networkName == "lpTestNet"
    }

    isProduction(networkName) {
        // Production includes mainnet and also a test network that is being used as a dry run before mainnet
        return networkName === "mainnet" || networkName === "rinkebyDryRun"
    }
}

module.exports = ContractDeployer
