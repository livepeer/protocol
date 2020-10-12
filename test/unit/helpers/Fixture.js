import RPC from "../../../utils/rpc"
import {contractId} from "../../../utils/helpers"

const Controller = artifacts.require("Controller")
const GenericMock = artifacts.require("GenericMock")
const BondingManagerMock = artifacts.require("BondingManagerMock")
const MinterMock = artifacts.require("MinterMock")

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
        this.minter = await this.deployAndRegister(MinterMock, "Minter")
        this.bondingManager = await this.deployAndRegister(BondingManagerMock, "BondingManager")
        this.roundsManager = await this.deployAndRegister(GenericMock, "RoundsManager")
        this.jobsManager = await this.deployAndRegister(GenericMock, "JobsManager")
        this.ticketBroker = await this.deployAndRegister(GenericMock, "TicketBroker")
        this.merkleSnapshot = await this.deployAndRegister(GenericMock, "MerkleSnapshot")
        // Register TicketBroker with JobsManager contract ID because in a production system the Minter likely will not be upgraded to be
        // aware of the TicketBroker contract ID and it will only be aware of the JobsManager contract ID
        await this.register("JobsManager", this.ticketBroker.address)
        this.verifier = await this.deployAndRegister(GenericMock, "Verifier")
    }

    async register(name, addr) {
        // Use dummy Git commit hash
        const commitHash = web3.utils.asciiToHex("0x123")
        await this.controller.setContractInfo(contractId(name), addr, commitHash)
    }

    async deployAndRegister(artifact, name, ...args) {
        const contract = await artifact.new(...args)
        await this.register(name, contract.address)
        return contract
    }

    async setUp() {
        this.currentSnapshotId = await this.rpc.snapshot()
    }

    async tearDown() {
        await this.rpc.revert(this.currentSnapshotId)
    }
}
