import Fixture from "../helpers/fixture"
import expectThrow from "../helpers/expectThrow"
import {functionSig} from "../../utils/helpers"

const GenesisManager = artifacts.require("GenesisManager")
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
            const genesisManager = await GenesisManager.new(
                randomAddress,
                randomAddress,
                randomAddress,
                randomAddress
            )

            const token = await genesisManager.token.call()
            assert.equal(token, randomAddress, "wrong token address")
            const tokenDistribution = await genesisManager.token.call()
            assert.equal(tokenDistribution, randomAddress, "wrong token distribution address")
            const bankMultisig = await genesisManager.bankMultisig.call()
            assert.equal(bankMultisig, randomAddress, "wrong bank multisig address")
            const minter = await genesisManager.minter.call()
            assert.equal(minter, randomAddress, "wrong minter address")
            const stage = await genesisManager.stage.call()
            assert.equal(stage, Stages.GenesisAllocation, "wrong stage")
        })
    })

    let fixture
    let genesisManager
    let tokenDistribution

    before(async () => {
        fixture = new Fixture(web3)
        tokenDistribution = await GenericMock.new()

        const token = await GenericMock.new()
        const bankMultisig = await GenericMock.new()
        const minter = await GenericMock.new()

        genesisManager = await GenesisManager.new(
            token.address,
            tokenDistribution.address,
            bankMultisig.address,
            minter.address
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
            // Set tokenDistribution to not be over
            await tokenDistribution.setMockBool(functionSig("isOver()"), false)
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
            // Set tokenDistribution to not be over
            await tokenDistribution.setMockBool(functionSig("isOver()"), false)
            // Transition to start stage
            await genesisManager.start()

            await expectThrow(genesisManager.start())
        })

        it("should fail if the token distribution is over", async () => {
            // Set tokenDistribution to be over
            await tokenDistribution.setMockBool(functionSig("isOver()"), true)

            await expectThrow(genesisManager.start())
        })

        it("should set the stage to the genesis start stage", async () => {
            // Set tokenDistribution to not be over
            await tokenDistribution.setMockBool(functionSig("isOver()"), false)
            await genesisManager.start()

            const stage = await genesisManager.stage.call()
            assert.equal(stage, Stages.GenesisStart, "wrong stage")
        })
    })

    describe("addTeamGrant", () => {
        const timeToCliff = 1 * 60 * 60
        const vestingDuration = 2 * 60 * 60

        it("should fail if sender is not the owner", async () => {
            // Set tokenDistribution to not be over
            await tokenDistribution.setMockBool(functionSig("isOver()"), false)
            await genesisManager.start()

            await expectThrow(genesisManager.addTeamGrant(accounts[0], 100, timeToCliff, vestingDuration, {from: accounts[1]}))
        })

        it("should fail if it is not the genesis start stage", async () => {
            await expectThrow(genesisManager.addTeamGrant(accounts[0], 100, timeToCliff, vestingDuration))
        })

        it("should fail if amount of grants created > team supply", async () => {
            await genesisManager.setAllocations(100, 10, 30, 40, 10, 10)
            // Set tokenDistribution to not be over
            await tokenDistribution.setMockBool(functionSig("isOver()"), false)
            await genesisManager.start()
            // Set token distribution end time
            const distributionEndTime = web3.eth.getBlock(web3.eth.blockNumber).timestamp + (1 * 60 * 60)
            await tokenDistribution.setMockUint256(functionSig("getEndTime()"), distributionEndTime)

            await expectThrow(genesisManager.addTeamGrant(accounts[0], 100, timeToCliff, vestingDuration))
        })

        it("should fail if the receiver already has a grant", async () => {
            await genesisManager.setAllocations(100, 10, 30, 40, 10, 10)
            // Set tokenDistribution to not be over
            await tokenDistribution.setMockBool(functionSig("isOver()"), false)
            await genesisManager.start()
            // Set token distribution end time
            const distributionEndTime = web3.eth.getBlock(web3.eth.blockNumber).timestamp + (1 * 60 * 60)
            await tokenDistribution.setMockUint256(functionSig("getEndTime()"), distributionEndTime)
            // Receiver gets grant
            await genesisManager.addTeamGrant(accounts[0], 5, timeToCliff, vestingDuration)

            await expectThrow(genesisManager.addTeamGrant(accounts[0], 4, timeToCliff, vestingDuration))
        })

        it("should create a TokenVesting address mapped to the receiver", async () => {
            await genesisManager.setAllocations(100, 10, 30, 40, 10, 10)
            // Set tokenDistribution to not be over
            await tokenDistribution.setMockBool(functionSig("isOver()"), false)
            await genesisManager.start()
            // Set token distribution end time
            const distributionEndTime = web3.eth.getBlock(web3.eth.blockNumber).timestamp + (1 * 60 * 60)
            await tokenDistribution.setMockUint256(functionSig("getEndTime()"), distributionEndTime)

            await genesisManager.addTeamGrant(accounts[0], 5, timeToCliff, vestingDuration)

            const holder = await genesisManager.vestingHolders.call(accounts[0])
            assert.notEqual(holder, "0x0000000000000000000000000000000000000000", "missing holder address")
        })
    })

    describe("addInvestorGrant", () => {
        const timeToCliff = 1 * 60 * 60
        const vestingDuration = 2 * 60 * 60

        it("should fail if sender is not the owner", async () => {
            // Set tokenDistribution to not be over
            await tokenDistribution.setMockBool(functionSig("isOver()"), false)
            await genesisManager.start()

            await expectThrow(genesisManager.addInvestorGrant(accounts[0], 100, timeToCliff, vestingDuration, {from: accounts[1]}))
        })

        it("should fail if it is not the genesis start stage", async () => {
            await expectThrow(genesisManager.addInvestorGrant(accounts[0], 100, timeToCliff, vestingDuration))
        })

        it("should fail if amount of grants created > team supply", async () => {
            await genesisManager.setAllocations(100, 10, 30, 40, 10, 10)
            // Set tokenDistribution to not be over
            await tokenDistribution.setMockBool(functionSig("isOver()"), false)
            await genesisManager.start()
            // Set token distribution end time
            await tokenDistribution.setMockUint256(functionSig("getEndTime()"), web3.eth.getBlock(web3.eth.blockNumber).timestamp + (1 * 60 * 60))

            await expectThrow(genesisManager.addInvestorGrant(accounts[0], 100, timeToCliff, vestingDuration))
        })

        it("should fail if the receiver already has a grant", async () => {
            await genesisManager.setAllocations(100, 10, 30, 40, 10, 10)
            // Set tokenDistribution to not be over
            await tokenDistribution.setMockBool(functionSig("isOver()"), false)
            await genesisManager.start()
            // Set token distribution end time
            await tokenDistribution.setMockUint256(functionSig("getEndTime()"), web3.eth.getBlock(web3.eth.blockNumber).timestamp + (1 * 60 * 60))
            // Receiver gets grant
            await genesisManager.addInvestorGrant(accounts[0], 5, timeToCliff, vestingDuration)

            await expectThrow(genesisManager.addInvestorGrant(accounts[0], 4, timeToCliff, vestingDuration))
        })

        it("should create a TokenVesting contract mapped to the receiver", async () => {
            await genesisManager.setAllocations(100, 10, 30, 40, 10, 10)
            // Set tokenDistribution to not be over
            await tokenDistribution.setMockBool(functionSig("isOver()"), false)
            await genesisManager.start()
            const distributionEndTime = web3.eth.getBlock(web3.eth.blockNumber).timestamp + (1 * 60 * 60)
            // Set token distribution end time
            await tokenDistribution.setMockUint256(functionSig("getEndTime()"), distributionEndTime)

            await genesisManager.addInvestorGrant(accounts[0], 5, timeToCliff, vestingDuration)

            const holder = await genesisManager.vestingHolders.call(accounts[0])
            assert.notEqual(holder !== "0x0000000000000000000000000000000000000000", "missing holder address")
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
            // Set tokenDistribution to not be over
            await tokenDistribution.setMockBool(functionSig("isOver()"), false)
            await genesisManager.start()

            await expectThrow(genesisManager.addCommunityGrant(accounts[0], 100))
        })

        it("should update the amount of grants created", async () => {
            await genesisManager.setAllocations(100, 10, 30, 40, 10, 10)
            // Set tokenDistribution to not be over
            await tokenDistribution.setMockBool(functionSig("isOver()"), false)
            await genesisManager.start()
            // Set token distribution end time
            const distributionEndTime = web3.eth.getBlock(web3.eth.blockNumber).timestamp + (1 * 60 * 60)
            await tokenDistribution.setMockUint256(functionSig("getEndTime()"), distributionEndTime)

            await genesisManager.addCommunityGrant(accounts[0], 10)

            const amount = await genesisManager.communityGrantsAmount.call()
            assert.equal(amount.toNumber(), 10, "wrong community grants amount")
        })

        it("should fail if the receiver already has a grant", async () => {
            await genesisManager.setAllocations(100, 10, 30, 40, 10, 10)
            // Set tokenDistribution to not be over
            await tokenDistribution.setMockBool(functionSig("isOver()"), false)
            await genesisManager.start()
            // Set token distribution end time
            const distributionEndTime = web3.eth.getBlock(web3.eth.blockNumber).timestamp + (1 * 60 * 60)
            await tokenDistribution.setMockUint256(functionSig("getEndTime()"), distributionEndTime)
            await genesisManager.addCommunityGrant(accounts[0], 5)

            await expectThrow(genesisManager.addCommunityGrant(accounts[0], 4))
        })

        it("should create a TokenTimelock address mapped to the receiver", async () => {
            await genesisManager.setAllocations(100, 10, 30, 40, 10, 10)
            // Set tokenDistribution to not be over
            await tokenDistribution.setMockBool(functionSig("isOver()"), false)
            await genesisManager.start()
            // Set token distribution end time
            const distributionEndTime = web3.eth.getBlock(web3.eth.blockNumber).timestamp + (1 * 60 * 60)
            await tokenDistribution.setMockUint256(functionSig("getEndTime()"), distributionEndTime)

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

        it("should fail if token distribution is not over", async () => {
            // Set tokenDistribution to not be over
            await tokenDistribution.setMockBool(functionSig("isOver()"), false)
            await genesisManager.start()

            await expectThrow(genesisManager.end())
        })

        it("should set the stage to genesis end", async () => {
            // Set tokenDistribution to not be over
            await tokenDistribution.setMockBool(functionSig("isOver()"), false)
            await genesisManager.start()
            // Set tokenDistribution to be over
            await tokenDistribution.setMockBool(functionSig("isOver()"), true)

            await genesisManager.end()

            const stage = await genesisManager.stage.call()
            assert.equal(stage, Stages.GenesisEnd, "wrong stage")
        })
    })
})
