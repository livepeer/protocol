const path = require("path")
const {Repository} = require("nodegit")
const {contractId} = require("./helpers")

class ContractDeployer {
    constructor(truffleDeployer, controllerArtifact, managerProxyArtifact) {
        this.truffleDeployer = truffleDeployer
        this.controllerArtifact = controllerArtifact
        this.managerProxyArtifact = managerProxyArtifact
    }

    async getGitHeadCommitHash() {
        const repoRootPath = path.resolve(__dirname, "..")
        const repo = await Repository.open(repoRootPath)
        const headCommit = await repo.getHeadCommit()
        return `0x${headCommit.sha()}`
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
}

module.exports = ContractDeployer
