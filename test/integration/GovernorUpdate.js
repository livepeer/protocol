import truffleAssert from "truffle-assertions"
import {utils} from "ethers"

import {constants} from "../../utils/constants"
import {contractId} from "../../utils/helpers"

const Controller = artifacts.require("Controller")
const BondingManager = artifacts.require("BondingManager")
const Governor = artifacts.require("Governor")
const Minter = artifacts.require("Minter")

contract("Governor update", accounts => {
    let controller
    let bondingManager
    let governor

    before(async () => {
        controller = await Controller.deployed()
        await controller.unpause()

        const bondingManagerAddr = await controller.getContract(contractId("BondingManager"))
        bondingManager = await BondingManager.at(bondingManagerAddr)

        // Deploy Governor
        governor = await Governor.new()
        // Transfer Controller ownership to Governor
        await controller.transferOwnership(governor.address)
    })

    it("controller is now owned by the governor", async () => {
        assert.equal(await controller.owner(), governor.address)
    })

    it("governor has the correct owner", async () => {
        assert.equal(await governor.owner(), accounts[0])
    })

    describe("single param change", () => {
        it("reverts when the param change is not initiated through the governor", async () => {
            await truffleAssert.reverts(
                bondingManager.setNumActiveTranscoders(20),
                "caller must be Controller owner"
            )
        })

        it("reverts when the delay for the staged update has not expired", async () => {
            const data = utils.hexlify(utils.arrayify(bondingManager.contract.methods.setNumActiveTranscoders(20).encodeABI()))
            const update = {
                target: [bondingManager.address],
                value: ["0"],
                data: [data],
                nonce: 0
            }
            await governor.stage(update, 10)

            await truffleAssert.reverts(
                governor.execute(update),
                "delay for update not expired"
            )
        })

        it("succesfully executes a single param change", async () => {
            const data = utils.hexlify(utils.arrayify(bondingManager.contract.methods.setNumActiveTranscoders(30).encodeABI()))
            const update = {
                target: [bondingManager.address],
                value: ["0"],
                data: [data],
                nonce: 0
            }
            await governor.stage(update, 0)

            let tx = await governor.execute(update)
            assert.equal((await bondingManager.getTranscoderPoolMaxSize()).toNumber(), 30)

            truffleAssert.eventEmitted(
                tx,
                "UpdateExecuted",
                e => e.update.target[0] == update.target[0]
                    && e.update.value[0] == update.value[0]
                    && e.update.data[0] == update.data[0],
                "UpdateStaged event not emitted correctly"
            )
        })
    })

    describe("complex update: migrate to new Minter", () => {
        // Minter upgrade steps
        // 1. Pause the protocol
        // 2. call migrateToNewMinter
        // 3. register the new Minter
        // 4. Unpause the protocol
        let minter
        let newMinter

        let pauseData
        let pauseTarget
        let migrateData
        let migrateTarget
        let setInfoData
        let setInfoTarget
        let unpauseData
        let unpauseTarget

        before(async () => {
            const minterAddr = await controller.getContract(contractId("Minter"))
            minter = await Minter.at(minterAddr)
            newMinter = await Minter.new(controller.address, "100", "1", "500000")

            pauseData = utils.hexlify(utils.arrayify(controller.contract.methods.pause().encodeABI()))
            pauseTarget = controller.address

            migrateData = utils.hexlify(utils.arrayify(minter.contract.methods.migrateToNewMinter(newMinter.address).encodeABI()))
            migrateTarget = minter.address

            setInfoData = utils.hexlify(utils.arrayify(controller.contract.methods.setContractInfo(contractId("Minter"), newMinter.address, "0x123").encodeABI()))
            setInfoTarget = controller.address

            unpauseData = utils.hexlify(utils.arrayify(controller.contract.methods.unpause().encodeABI()))
            unpauseTarget = controller.address
        })


        it("step 1 'pause' fails: the protocol is already paused", async () => {
            // pause twice
            const update = {
                target: [pauseTarget, pauseTarget, migrateTarget, setInfoTarget, unpauseTarget],
                value: ["0", "0", "0", "0", "0"],
                data: [pauseData, pauseData, migrateData, setInfoData, unpauseData],
                nonce: 0
            }

            // run the migrate to new minter update
            await governor.stage(update, "0")
            await truffleAssert.reverts(governor.execute(update))
        })

        it("step 2 'migrateToNewMinter' fails: the protocol is not paused", async () => {
            // omit pausing from the update
            const update = {
                target: [pauseTarget, unpauseTarget, migrateTarget, setInfoTarget, unpauseTarget],
                value: ["0", "0", "0", "0", "0"],
                data: [pauseData, unpauseData, migrateData, setInfoData, unpauseData],
                nonce: 0
            }

            // run the migrate to new minter update
            await governor.stage(update, "0")
            await truffleAssert.reverts(governor.execute(update), "system is not paused")
        })

        it("step 2 'migrateToNewMinter' fails: new Minter cannot be current Minter", async () => {
            // the previous test should have reverted in it's entirety
            // so we should not run into an "already paused" error

            migrateData = utils.hexlify(utils.arrayify(minter.contract.methods.migrateToNewMinter(minter.address).encodeABI()))


            const update = {
                target: [pauseTarget, migrateTarget, setInfoTarget, unpauseTarget],
                value: ["0", "0", "0", "0"],
                data: [pauseData, migrateData, setInfoData, unpauseData],
                nonce: 0
            }

            // run the migrate to new minter update
            await governor.stage(update, "0")
            await truffleAssert.reverts(governor.execute(update), "new Minter cannot be current Minter")
        })

        it("step 2 'migrateToNewMinter' fails: new Minter cannot be null address", async () => {
            migrateData = utils.hexlify(utils.arrayify(minter.contract.methods.migrateToNewMinter(constants.NULL_ADDRESS).encodeABI()))


            const update = {
                target: [pauseTarget, migrateTarget, setInfoTarget, unpauseTarget],
                value: ["0", "0", "0", "0"],
                data: [pauseData, migrateData, setInfoData, unpauseData],
                nonce: 0
            }

            // run the migrate to new minter update
            await governor.stage(update, "0")
            await truffleAssert.reverts(governor.execute(update), "new Minter cannot be null address")
        })

        it("step 3 'setContractInfo' fails: wrong target", async () => {
            migrateData = utils.hexlify(utils.arrayify(minter.contract.methods.migrateToNewMinter(newMinter.address).encodeABI()))

            const update = {
                target: [pauseTarget, migrateTarget, migrateTarget, unpauseTarget],
                value: ["0", "0", "0", "0"],
                data: [pauseData, migrateData, setInfoData, unpauseData],
                nonce: 0
            }

            // run the migrate to new minter update
            await governor.stage(update, "0")
            await truffleAssert.reverts(governor.execute(update))
        })

        it("step 4 'unpause' fails: system is already unpaused", async () => {
            // call unpause twice in the update
            const update = {
                target: [pauseTarget, migrateTarget, setInfoTarget, unpauseTarget, unpauseTarget],
                value: ["0", "0", "0", "0", "0"],
                data: [pauseData, migrateData, setInfoData, unpauseData, unpauseData],
                nonce: 0
            }

            // run the migrate to new minter update
            await governor.stage(update, "0")
            await truffleAssert.reverts(governor.execute(update))
        })

        it("succesfully executes all updates", async () => {
            const update = {
                target: [pauseTarget, migrateTarget, setInfoTarget, unpauseTarget],
                value: ["0", "0", "0", "0"],
                data: [pauseData, migrateData, setInfoData, unpauseData],
                nonce: 0
            }

            // run the migrate to new minter update
            await governor.stage(update, "0")
            await governor.execute(update)

            const actualNewMinterAddr = (await controller.getContractInfo(contractId("Minter")))[0]
            assert.equal(actualNewMinterAddr, newMinter.address)
        })
    })
})
