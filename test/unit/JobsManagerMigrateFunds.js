import Fixture from "./helpers/Fixture"
import expectThrow from "../helpers/expectThrow"
import {functionEncodedABI} from "../../utils/helpers"

const JobsManager = artifacts.require("JobsManager")
const JobLib = artifacts.require("JobLib")

contract("JobsManagerMigrateFunds", accounts => {
    let fixture
    let jobsManager

    before(async () => {
        fixture = new Fixture(web3)
        await fixture.deploy()

        await JobsManager.link("JobLib", JobLib.address)
        jobsManager = await fixture.deployAndRegister(JobsManager, "JobsManager", fixture.controller.address)
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("migrateFunds", () => {
        const owner = accounts[0]
        const refunder = accounts[1]

        it("should revert if caller is not Controller owner", async () => {
            const notOwner = accounts[2]
            await expectThrow(jobsManager.migrateFunds(refunder, 100, {from: notOwner}))
        })

        it("should revert if funds have been migrated", async () => {
            await jobsManager.migrateFunds(refunder, 100, {from: owner})

            await expectThrow(jobsManager.migrateFunds(refunder, 2000, {from: owner}))
        })

        it("should migrate funds", async () => {
            // Make sure that fundsMigrated = false at first
            await assert.isNotOk(await jobsManager.fundsMigrated.call())

            const {logs} = await jobsManager.migrateFunds(refunder, 100, {from: owner})
            const event = logs.find(e => e.event === "FundsMigrated")
            assert.equal(event.args.refunder, refunder)
            assert.equal(event.args.amount, 100)

            assert.isOk(await jobsManager.fundsMigrated.call())
        })
    })

    describe("deposit", () => {
        it("should revert", async () => {
            await expectThrow(jobsManager.deposit())
        })
    })

    describe("withdraw", () => {
        it("should revert", async () => {
            await expectThrow(jobsManager.deposit())
        })
    })

    describe("job", () => {
        it("should revert", async () => {
            await expectThrow(jobsManager.job("foo", "bar", 1, 2))
        })
    })

    describe("claimWork", () => {
        it("should revert", async () => {
            await expectThrow(jobsManager.claimWork(1, [2, 3], "0xfoo"))
        })
    })

    describe("verify", () => {
        it("should revert", async () => {
            await expectThrow(
                jobsManager.verify(
                    0,
                    1,
                    2,
                    "foo",
                    ["0xfoo", "0xbar"],
                    "0xfoo",
                    "0xbar"
                )
            )
        })
    })

    describe("receiveVerification", () => {
        it("should revert", async () => {
            await expectThrow(
                fixture.verifier.execute(
                    jobsManager.address,
                    functionEncodedABI(
                        "receiveVerification(uint256,uint256,uint256,bool)",
                        ["uint256", "uint256", "uint256", "bool"],
                        [0, 0, 0, false]
                    )
                )
            )
        })
    })

    describe("missedVerificationSlash", () => {
        it("should revert", async () => {
            await expectThrow(jobsManager.missedVerificationSlash(0, 1, 2))
        })
    })

    describe("doubleClaimSegmentSlash", () => {
        it("should revert", async () => {
            await expectThrow(jobsManager.doubleClaimSegmentSlash(0, 1, 2, 3))
        })
    })

    describe("distributeFees", () => {
        it("should revert", async () => {
            await expectThrow(jobsManager.distributeFees(0, 1))
        })
    })
})
