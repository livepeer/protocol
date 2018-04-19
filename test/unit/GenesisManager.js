import Fixture from "./helpers/Fixture"
import expectThrow from "../helpers/expectThrow"

const GenesisManager = artifacts.require("GenesisManager")
const TokenVesting = artifacts.require("TokenVesting")
const GenericMock = artifacts.require("GenericMock")

const Stages = {
    GenesisAllocation: 0,
    GenesisStart: 1,
    GenesisEnd: 2
}

contract("GenesisManager", accounts => {
    describe("constructor", () => {
        it("should set parameters and stage to the allocation stage", async () => {
            const randomAddress = accounts[0]
            const timeToGrantsStart = 60 * 60 * 24 * 7
            const grantsStartTimestamp = web3.eth.getBlock("latest").timestamp + timeToGrantsStart
            const genesisManager = await GenesisManager.new(
                randomAddress,
                randomAddress,
                randomAddress,
                randomAddress,
                grantsStartTimestamp
            )

            const token = await genesisManager.token.call()
            assert.equal(token, randomAddress, "wrong token address")
            const tokenDistribution = await genesisManager.token.call()
            assert.equal(tokenDistribution, randomAddress, "wrong token distribution address")
            const bankMultisig = await genesisManager.bankMultisig.call()
            assert.equal(bankMultisig, randomAddress, "wrong bank multisig address")
            const minter = await genesisManager.minter.call()
            assert.equal(minter, randomAddress, "wrong minter address")
            assert.equal(await genesisManager.grantsStartTimestamp.call(), grantsStartTimestamp, "wrong grants start timestamp")
            const stage = await genesisManager.stage.call()
            assert.equal(stage, Stages.GenesisAllocation, "wrong stage")
        })
    })

    let fixture
    let genesisManager
    let tokenDistribution = accounts[0]
    let bankMultisig = accounts[1]

    before(async () => {
        fixture = new Fixture(web3)

        const token = await GenericMock.new()
        const minter = await GenericMock.new()
        const timeToGrantsStart = 60 * 60 * 24 * 7
        const grantsStartTimestamp = web3.eth.getBlock("latest").timestamp + timeToGrantsStart

        genesisManager = await GenesisManager.new(
            token.address,
            tokenDistribution,
            bankMultisig,
            minter.address,
            grantsStartTimestamp
        )
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("setAllocations", () => {
        it("should fail if sender is not the owner", async () => {
            await expectThrow(genesisManager.setAllocations(100, 10, 30, 40, 10, 10, {from: accounts[1]}))
        })

        it("should fail if provided allocations do not sum to provided initial supply", async () => {
            await expectThrow(genesisManager.setAllocations(100, 20, 20, 20, 20, 25))
        })

        it("should set supplies based on provided allocations", async () => {
            await genesisManager.setAllocations(100, 10, 30, 40, 10, 10)

            const initialSupply = await genesisManager.initialSupply.call()
            assert.equal(initialSupply.toNumber(), 100, "wrong initial supply")
            const crowdSupply = await genesisManager.crowdSupply.call()
            assert.equal(crowdSupply.toNumber(), 10, "wrong crowd supply")
            const companySupply = await genesisManager.companySupply.call()
            assert.equal(companySupply.toNumber(), 30, "wrong company supply")
            const teamSupply = await genesisManager.teamSupply.call()
            assert.equal(teamSupply.toNumber(), 40, "wrong team supply")
            const investorsSupply = await genesisManager.investorsSupply.call()
            assert.equal(investorsSupply.toNumber(), 10, "wrong investors supply")
            const communitySupply = await genesisManager.communitySupply.call()
            assert.equal(communitySupply.toNumber(), 10, "wrong community supply")
        })

        it("should fail if it is not the allocation stage", async () => {
            // Transition to start stage
            await genesisManager.start()

            await expectThrow(genesisManager.setAllocations(100, 10, 30, 40, 10, 10))
        })
    })

    describe("start", () => {
        it("should fail if sender is not the owner", async () => {
            await expectThrow(genesisManager.start({from: accounts[1]}))
        })

        it("should fail if it is not the allocation stage", async () => {
            // Transition to start stage
            await genesisManager.start()

            await expectThrow(genesisManager.start())
        })

        it("should set the stage to the genesis start stage", async () => {
            await genesisManager.start()

            const stage = await genesisManager.stage.call()
            assert.equal(stage, Stages.GenesisStart, "wrong stage")
        })
    })

    describe("addTeamGrant", () => {
        const timeToCliff = 1 * 60 * 60
        const vestingDuration = 2 * 60 * 60

        it("should fail if sender is not the owner", async () => {
            await genesisManager.start()

            await expectThrow(genesisManager.addTeamGrant(accounts[0], 100, timeToCliff, vestingDuration, {from: accounts[1]}))
        })

        it("should fail if it is not the genesis start stage", async () => {
            await expectThrow(genesisManager.addTeamGrant(accounts[0], 100, timeToCliff, vestingDuration))
        })

        it("should fail if amount of grants created > team supply", async () => {
            await genesisManager.setAllocations(100, 10, 30, 40, 10, 10)
            await genesisManager.start()

            await expectThrow(genesisManager.addTeamGrant(accounts[0], 100, timeToCliff, vestingDuration))
        })

        it("should fail if the receiver already has a grant", async () => {
            await genesisManager.setAllocations(100, 10, 30, 40, 10, 10)
            await genesisManager.start()
            // Receiver gets grant
            await genesisManager.addTeamGrant(accounts[0], 5, timeToCliff, vestingDuration)

            await expectThrow(genesisManager.addTeamGrant(accounts[0], 4, timeToCliff, vestingDuration))
        })

        it("should create a TokenVesting address mapped to the receiver", async () => {
            await genesisManager.setAllocations(100, 10, 30, 40, 10, 10)
            await genesisManager.start()

            await genesisManager.addTeamGrant(accounts[0], 5, timeToCliff, vestingDuration)

            const holder = await genesisManager.vestingHolders.call(accounts[0])
            assert.notEqual(holder, "0x0000000000000000000000000000000000000000", "missing holder address")
        })

        it("should transfer ownership of TokenVesting contract to bank multisig", async () => {
            await genesisManager.setAllocations(100, 10, 30, 40, 10, 10)
            await genesisManager.start()

            await genesisManager.addInvestorGrant(accounts[0], 5, timeToCliff, vestingDuration)

            const holderAddr = await genesisManager.vestingHolders.call(accounts[0])
            const holder = await TokenVesting.at(holderAddr)
            assert.equal(await holder.owner.call(), bankMultisig, "wrong TokenVesting owner")
        })
    })

    describe("addInvestorGrant", () => {
        const timeToCliff = 1 * 60 * 60
        const vestingDuration = 2 * 60 * 60

        it("should fail if sender is not the owner", async () => {
            await genesisManager.start()

            await expectThrow(genesisManager.addInvestorGrant(accounts[0], 100, timeToCliff, vestingDuration, {from: accounts[1]}))
        })

        it("should fail if it is not the genesis start stage", async () => {
            await expectThrow(genesisManager.addInvestorGrant(accounts[0], 100, timeToCliff, vestingDuration))
        })

        it("should fail if amount of grants created > team supply", async () => {
            await genesisManager.setAllocations(100, 10, 30, 40, 10, 10)
            await genesisManager.start()

            await expectThrow(genesisManager.addInvestorGrant(accounts[0], 100, timeToCliff, vestingDuration))
        })

        it("should fail if the receiver already has a grant", async () => {
            await genesisManager.setAllocations(100, 10, 30, 40, 10, 10)
            await genesisManager.start()
            // Receiver gets grant
            await genesisManager.addInvestorGrant(accounts[0], 5, timeToCliff, vestingDuration)

            await expectThrow(genesisManager.addInvestorGrant(accounts[0], 4, timeToCliff, vestingDuration))
        })

        it("should create a TokenVesting contract mapped to the receiver", async () => {
            await genesisManager.setAllocations(100, 10, 30, 40, 10, 10)
            await genesisManager.start()

            await genesisManager.addInvestorGrant(accounts[0], 5, timeToCliff, vestingDuration)

            const holder = await genesisManager.vestingHolders.call(accounts[0])
            assert.notEqual(holder !== "0x0000000000000000000000000000000000000000", "missing holder address")
        })

        it("should transfer ownership of TokenVesting contract to bank multisig", async () => {
            await genesisManager.setAllocations(100, 10, 30, 40, 10, 10)
            await genesisManager.start()

            await genesisManager.addInvestorGrant(accounts[0], 5, timeToCliff, vestingDuration)

            const holderAddr = await genesisManager.vestingHolders.call(accounts[0])
            const holder = await TokenVesting.at(holderAddr)
            assert.equal(await holder.owner.call(), bankMultisig, "wrong TokenVesting owner")
        })
    })

    describe("addCommunityGrant", () => {
        it("should fail if sender is not the owner", async () => {
            await expectThrow(genesisManager.addCommunityGrant(accounts[0], 10, {from: accounts[1]}))
        })

        it("should fail if it is not the genesis start stage", async () => {
            await expectThrow(genesisManager.addCommunityGrant(accounts[0], 10))
        })

        it("should fail if amount of grants created > community supply", async () => {
            await genesisManager.setAllocations(100, 10, 30, 40, 10, 10)
            await genesisManager.start()

            await expectThrow(genesisManager.addCommunityGrant(accounts[0], 100))
        })

        it("should update the amount of grants created", async () => {
            await genesisManager.setAllocations(100, 10, 30, 40, 10, 10)
            await genesisManager.start()

            await genesisManager.addCommunityGrant(accounts[0], 10)

            const amount = await genesisManager.communityGrantsAmount.call()
            assert.equal(amount.toNumber(), 10, "wrong community grants amount")
        })

        it("should fail if the receiver already has a grant", async () => {
            await genesisManager.setAllocations(100, 10, 30, 40, 10, 10)
            await genesisManager.start()
            await genesisManager.addCommunityGrant(accounts[0], 5)

            await expectThrow(genesisManager.addCommunityGrant(accounts[0], 4))
        })

        it("should create a TokenTimelock address mapped to the receiver", async () => {
            await genesisManager.setAllocations(100, 10, 30, 40, 10, 10)
            await genesisManager.start()

            await genesisManager.addCommunityGrant(accounts[0], 5)

            const holder = await genesisManager.timeLockedHolders.call(accounts[0])
            assert.notEqual(holder, "0x0000000000000000000000000000000000000000", "missing holder address")
        })
    })

    describe("end", () => {
        it("should fail if sender is not the owner", async () => {
            await expectThrow(genesisManager.end({from: accounts[1]}))
        })

        it("should fail if it is not the genesis start stage", async () => {
            await expectThrow(genesisManager.end())
        })

        it("should set the stage to genesis end", async () => {
            await genesisManager.start()
            await genesisManager.end()

            const stage = await genesisManager.stage.call()
            assert.equal(stage, Stages.GenesisEnd, "wrong stage")
        })
    })
})
