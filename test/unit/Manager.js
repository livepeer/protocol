import Fixture from "./helpers/Fixture"

import {web3, ethers} from "hardhat"

import chai, {expect, assert} from "chai"
import {solidity} from "ethereum-waffle"
chai.use(solidity)

describe("Manager", () => {
    let fixture
    let manager

    before(async () => {
        fixture = new Fixture(web3)
        await fixture.deploy()
        await fixture.deployAndRegister(
            await ethers.getContractFactory("ManagerFixture"),
            "ManagerFixture",
            fixture.controller.address
        )

        const managerFixtureFac = await ethers.getContractFactory(
            "ManagerFixture"
        )
        const managerFixture = await managerFixtureFac.deploy(
            fixture.controller.address
        )
        manager = await ethers.getContractAt(
            "ManagerFixture",
            managerFixture.address
        )
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    // This is the only function not already tested in other tests, so it's the only one tested here
    describe("whenSystemPaused", () => {
        it("should disallow the call when the system is not paused", async () => {
            await expect(manager.checkSchrodingerCat()).to.be.revertedWith(
                "system is not paused"
            )
        })

        it("should allow the call when the system is paused", async () => {
            await fixture.controller.pause()
            const state = await manager.checkSchrodingerCat()
            assert.equal(state, "alive")
        })
    })
})
