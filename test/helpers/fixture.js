import RPC from "../../utils/rpc"
import ethUtil from "ethereumjs-util"
import ethAbi from "ethereumjs-abi"

const Controller = artifacts.require("Controller")
const LivepeerTokenMock = artifacts.require("LivepeerTokenMock")
const MinterMock = artifacts.require("MinterMock")
const BondingManagerMock = artifacts.require("BondingManagerMock")
const RoundsManagerMock = artifacts.require("RoundsManagerMock")
const JobsManagerMock = artifacts.require("JobsManagerMock")
const IdentityVerifier = artifacts.require("IdentityVerifier")

export default class Fixture {
    constructor(web3) {
        this.rpc = new RPC(web3)
        this.contracts = {
            "LivepeerToken": null,
            "Minter": null,
            "BondingManager": null,
            "JobsManager": null,
            "RoundsManager": null
        }
    }

    async deployController() {
        this.controller = await Controller.new()
    }

    async deployMocks() {
        this.token = await this.deployAndRegister(LivepeerTokenMock, "LivepeerToken")
        this.minter = await this.deployAndRegister(MinterMock, "Minter")
        this.bondingManager = await this.deployAndRegister(BondingManagerMock, "BondingManager")
        this.roundsManager = await this.deployAndRegister(RoundsManagerMock, "RoundsManager")
        this.jobsManager = await this.deployAndRegister(JobsManagerMock, "JobsManager")
        this.verifier = await this.deployAndRegistery(IdentityVerifier, "Verifier")
    }

    async deployAndRegister(artifact, name, args = []) {
        const contract = await artifact.new(...args)
        await this.controller.setContract(this.contractId(name), contract.address)
        return contract
    }

    async setUp() {
        this.currentSnapshotId = await this.rpc.snapshot()
    }

    async tearDown() {
        await this.rpc.revert(this.currentSnapshotId)
    }

    contractId(name) {
        return ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], [name]))
    }
}
