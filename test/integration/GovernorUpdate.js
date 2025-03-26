import {contractId} from "../../utils/helpers"

import {ethers} from "hardhat"
import setupIntegrationTest from "../helpers/setupIntegrationTest"

import chai, {assert, expect} from "chai"
import {solidity} from "ethereum-waffle"
chai.use(solidity)

describe("Governor update", () => {
    let controller
    let livepeerToken
    let bondingManager
    let governor
    let minter

    let signers
    const DEFAULT_ADMIN_ROLE = ethers.constants.HashZero

    before(async () => {
        signers = await ethers.getSigners()
        const fixture = await setupIntegrationTest()
        controller = await ethers.getContractAt(
            "Controller",
            fixture.Controller.address
        )
        bondingManager = await ethers.getContractAt(
            "BondingManager",
            fixture.BondingManager.address
        )
        minter = await ethers.getContractAt("Minter", fixture.Minter.address)
        governor = await ethers.getContractAt(
            "Governor",
            fixture.Governor.address
        )
        livepeerToken = await ethers.getContractAt(
            "LivepeerToken",
            fixture.LivepeerToken.address
        )

        await controller.unpause()
        // Transfer Controller ownership to Governor
        await controller.transferOwnership(governor.address)
    })

    it("controller is now owned by the governor", async () => {
        assert.equal(await controller.owner(), governor.address)
    })

    it("governor has the correct owner", async () => {
        assert.equal(await governor.owner(), signers[0].address)
    })

    it("governor has livepeer token admin role", async () => {
        assert.isTrue(
            await livepeerToken.hasRole(DEFAULT_ADMIN_ROLE, governor.address)
        )
    })

    describe("single param change", () => {
        it("reverts when the param change is not initiated through the governor", async () => {
            await expect(
                bondingManager.setNumActiveTranscoders(20)
            ).to.be.revertedWith("caller must be Controller owner")
        })

        it("reverts when the delay for the staged update has not expired", async () => {
            const data = await bondingManager.interface.encodeFunctionData(
                "setNumActiveTranscoders",
                [20]
            )
            const update = {
                target: [bondingManager.address],
                value: ["0"],
                data: [data],
                nonce: 0
            }
            await governor.stage(update, 10)

            await expect(governor.execute(update)).to.be.revertedWith(
                "delay for update not expired"
            )
        })

        it("successfully executes a single param change", async () => {
            const data = await bondingManager.interface.encodeFunctionData(
                "setNumActiveTranscoders",
                [30]
            )
            const update = {
                target: [bondingManager.address],
                value: ["0"],
                data: [data],
                nonce: 0
            }
            await governor.stage(update, 0)

            const tx = governor.execute(update)
            await expect(tx)
                .to.emit(governor, "UpdateExecuted")
                .withArgs([...update])

            assert.equal(
                (await bondingManager.getTranscoderPoolMaxSize()).toNumber(),
                30
            )
        })
    })

    describe("complex update: migrate to new Minter", () => {
        // Minter upgrade steps
        // 1. Call migrateToNewMinter on previous Minter
        // 2. Call migrateOldMinterState on new Minter
        // 3. Grant MINTER_ROLE to new Minter
        // 4. Revoke MINTER_ROLE from previous Minter
        // 5. Register new Minter in Controller
        let newMinter

        let migrateData
        let migrateTarget
        let transferStateData
        let transferStateTarget
        let grantRoleData
        let grantRoleTarget
        let revokeRoleData
        let revokeRoleTarget
        let setInfoData
        let setInfoTarget

        before(async () => {
            const minterFac = await ethers.getContractFactory("Minter")
            newMinter = await minterFac.deploy(
                controller.address,
                "100",
                "1",
                "500000",
                "150",
                "50"
            )

            migrateData = minter.interface.encodeFunctionData(
                "migrateToNewMinter",
                [newMinter.address]
            )
            migrateTarget = minter.address

            transferStateData = newMinter.interface.encodeFunctionData(
                "migrateOldMinterState"
            )
            transferStateTarget = newMinter.address

            setInfoData = controller.interface.encodeFunctionData(
                "setContractInfo",
                [
                    contractId("Minter"),
                    newMinter.address,
                    "0x3031323334353637383930313233343536373839"
                ]
            )
            setInfoTarget = controller.address

            grantRoleData = livepeerToken.interface.encodeFunctionData(
                "grantRole",
                [
                    ethers.utils.solidityKeccak256(["string"], ["MINTER_ROLE"]),
                    newMinter.address
                ]
            )
            grantRoleTarget = livepeerToken.address

            revokeRoleData = livepeerToken.interface.encodeFunctionData(
                "revokeRole",
                [
                    ethers.utils.solidityKeccak256(["string"], ["MINTER_ROLE"]),
                    minter.address
                ]
            )
            revokeRoleTarget = livepeerToken.address
        })

        it("step 1 'migrateToNewMinter' fails: new Minter cannot be current Minter", async () => {
            const migrateData = minter.interface.encodeFunctionData(
                "migrateToNewMinter",
                [minter.address]
            )

            const update = {
                target: [
                    migrateTarget,
                    transferStateTarget,
                    grantRoleTarget,
                    revokeRoleTarget,
                    setInfoTarget
                ],
                value: ["0", "0", "0", "0", "0"],
                data: [
                    migrateData,
                    transferStateData,
                    grantRoleData,
                    revokeRoleData,
                    setInfoData
                ],
                nonce: 0
            }

            // Run the migrate to new minter update
            await governor.stage(update, "0")
            await expect(governor.execute(update)).to.be.revertedWith(
                "new Minter cannot be current Minter"
            )
        })

        it("step 1 'migrateToNewMinter' fails: new Minter cannot be null address", async () => {
            const migrateData = minter.interface.encodeFunctionData(
                "migrateToNewMinter",
                [ethers.constants.AddressZero]
            )

            const update = {
                target: [
                    migrateTarget,
                    transferStateTarget,
                    grantRoleTarget,
                    revokeRoleTarget,
                    setInfoTarget
                ],
                value: ["0", "0", "0", "0", "0"],
                data: [
                    migrateData,
                    transferStateData,
                    grantRoleData,
                    revokeRoleData,
                    setInfoData
                ],
                nonce: 0
            }

            // Run the migrate to new minter update
            await governor.stage(update, "0")
            await expect(governor.execute(update)).to.be.revertedWith(
                "new Minter cannot be null address"
            )
        })

        it("step 1 'migrateToNewMinter' fails: new Minter must be registered", async () => {
            const migrateTarget = newMinter.address
            const migrateData = minter.interface.encodeFunctionData(
                "migrateToNewMinter",
                // Minter is currently registered in Controller
                [minter.address]
            )
            const update = {
                target: [
                    migrateTarget,
                    transferStateTarget,
                    grantRoleTarget,
                    revokeRoleTarget,
                    setInfoTarget
                ],
                value: ["0", "0", "0", "0", "0"],
                data: [
                    migrateData,
                    transferStateData,
                    grantRoleData,
                    revokeRoleData,
                    setInfoData
                ],
                nonce: 0
            }

            // Run the migrate to new minter update
            await governor.stage(update, "0")
            await expect(governor.execute(update)).to.be.revertedWith(
                "new Minter must be registered"
            )
        })

        it("step 2 'transferStateData' fails: wrong target", async () => {
            const update = {
                target: [
                    migrateTarget,
                    migrateTarget,
                    grantRoleTarget,
                    revokeRoleTarget,
                    setInfoTarget
                ],
                value: ["0", "0", "0", "0", "0"],
                data: [
                    migrateData,
                    transferStateData,
                    grantRoleData,
                    revokeRoleData,
                    setInfoData
                ],
                nonce: 0
            }

            // Run the migrate to new minter update
            await governor.stage(update, "0")
            await expect(governor.execute(update)).to.be.reverted
        })

        it("succesfully executes all updates", async () => {
            const update = {
                target: [
                    migrateTarget,
                    transferStateTarget,
                    grantRoleTarget,
                    revokeRoleTarget,
                    setInfoTarget
                ],
                value: ["0", "0", "0", "0", "0"],
                data: [
                    migrateData,
                    transferStateData,
                    grantRoleData,
                    revokeRoleData,
                    setInfoData
                ],
                nonce: 0
            }

            // Run the migrate to new minter update
            await governor.stage(update, "0")
            await governor.execute(update)

            const actualNewMinterAddr = (
                await controller.getContractInfo(contractId("Minter"))
            )[0]
            assert.equal(actualNewMinterAddr, newMinter.address)
        })
    })
})
