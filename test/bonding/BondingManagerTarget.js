import ethAbi from "ethereumjs-abi"
import ethUtil from "ethereumjs-util"

const BondingManager = artifacts.require("BondingManager")
const Controller = artifacts.require("Controller")
const ManagerProxy = artifacts.require("ManagerProxy")

contract("BondingManagerTarget", accounts => {
    const managerId = ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["BondingManagerTarget"]))
    const managerProxyId = ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["BondingManager"]))

    let managerProxy

    before(async () => {
        const controller = await Controller.new()

        const manager = await BondingManager.new(controller.address)
        await controller.setContract(managerId, manager.address)

        const proxy = await ManagerProxy.new(controller.address, managerId)
        await controller.setContract(managerProxyId, proxy.address)

        managerProxy = await BondingManager.at(proxy.address)

        await controller.unpause()
    })

    it("works", async () => {
        await managerProxy.initialize(10, 1)
        console.log(await managerProxy.unbondingPeriod.call())

        await managerProxy.transcoder(5, 10, 15, {from: accounts[0]})
        console.log(await managerProxy.getTranscoderPendingBlockRewardCut(accounts[0]))
        console.log(await managerProxy.getTranscoderPendingFeeShare(accounts[0]))
        console.log(await managerProxy.getTranscoderPendingPricePerSegment(accounts[0]))
        console.log(await managerProxy.getCandidatePoolSize())
        console.log(await managerProxy.getReservePoolSize())
    })
})
