import RPC from "../../../utils/rpc"
import {contractId} from "../../../utils/helpers"

const Controller = artifacts.require("Controller")
const GenericMock = artifacts.require("GenericMock")

export default class Fixture {
    constructor(web3) {
        this.rpc = new RPC(web3)
    }

    async deploy() {
        this.controller = await Controller.new()

        await this.deployMocks()
        await this.controller.unpause()
    }

    async deployMocks() {
        this.token = await this.deployAndRegister(GenericMock, "LivepeerToken")
        this.minter = await this.deployAndRegister(GenericMock, "Minter")
        this.bondingManager = await this.deployAndRegister(GenericMock, "BondingManager")
        this.roundsManager = await this.deployAndRegister(GenericMock, "RoundsManager")
        this.jobsManager = await this.deployAndRegister(GenericMock, "JobsManager")
        this.verifier = await this.deployAndRegister(GenericMock, "Verifier")
    }

    async deployAndRegister(artifact, name, ...args) {
        const contract = await artifact.new(...args)
        // Use dummy Git commit hash
        const commitHash = "0x123"
        await this.controller.setContractInfo(contractId(name), contract.address, commitHash)
        return contract
    }

    async setUp() {
        this.currentSnapshotId = await this.rpc.snapshot()
    }

    async tearDown() {
        await this.rpc.revert(this.currentSnapshotId)
    }
}
