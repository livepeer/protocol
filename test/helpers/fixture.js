import RPC from "../../utils/rpc"
import ethUtil from "ethereumjs-util"
import ethAbi from "ethereumjs-abi"
import {functionSig} from "../../utils/helpers"

const Controller = artifacts.require("Controller")
const LivepeerTokenMock = artifacts.require("LivepeerTokenMock")
const MinterMock = artifacts.require("MinterMock")
const BondingManagerMock = artifacts.require("BondingManagerMock")
const RoundsManagerMock = artifacts.require("RoundsManagerMock")
const JobsManagerMock = artifacts.require("JobsManagerMock")
const VerifierMock = artifacts.require("VerifierMock")

export default class Fixture {
    constructor(web3) {
        this.rpc = new RPC(web3)
    }

    async deployController() {
        this.controller = await Controller.new()
        await this.controller.unpause()
    }

    async deployMocks() {
        this.token = await this.deployAndRegister(LivepeerTokenMock, "LivepeerToken")
        this.minter = await this.deployAndRegister(MinterMock, "Minter")
        this.bondingManager = await this.deployAndRegister(BondingManagerMock, "BondingManager")
        this.roundsManager = await this.deployAndRegister(RoundsManagerMock, "RoundsManager")
        this.jobsManager = await this.deployAndRegister(JobsManagerMock, "JobsManager")
        this.verifier = await this.deployAndRegister(VerifierMock, "Verifier")
    }

    async deployAndRegister(artifact, name, ...args) {
        const contract = await artifact.new(...args)
        await this.controller.setContract(this.contractId(name), contract.address)
        return contract
    }

    async addPermissions() {
        const owner = await this.controller.owner()

        await this.controller.addPermission(owner, this.bondingManager.address, functionSig("setParameters(uint64,uint256,uint256)"))
        await this.controller.addPermission(owner, this.jobsManager.address, functionSig("setParameters(uint64,uint256,uint256,uint64,uint64,uint64,uint64)"))
        await this.controller.addPermission(owner, this.roundsManager.address, functionSig("setParameters(uint256,uint256)"))

        await this.controller.addPermission(this.jobsManager.address, this.bondingManager.address, functionSig("updateTranscoderWithFees(address,uint256,uint256)"))
        await this.controller.addPermission(this.roundsManager.address, this.bondingManager.address, functionSig("setActiveTranscoders()"))

        await this.controller.addPermission(this.verifier.address, this.jobsManager.address, functionSig("receiveVerification(uint256,uint256,uint256,bool)"))

        await this.controller.addPermission(this.bondingManager.address, this.minter.address, functionSig("createReward(uint256,uint256)"))
        await this.controller.addPermission(this.bondingManager.address, this.minter.address, functionSig("transferTokens(address,uint256)"))
        await this.controller.addPermission(this.bondingManager.address, this.minter.address, functionSig("addToRedistributionPool(uint256)"))
        await this.controller.addPermission(this.jobsManager.address, this.minter.address, functionSig("transferTokens(address,uint256)"))
        await this.controller.addPermission(this.roundsManager.address, this.minter.address, functionSig("setCurrentRewardTokens()"))
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
