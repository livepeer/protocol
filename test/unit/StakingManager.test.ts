import Fixture from "./helpers/Fixture"
import {web3, ethers} from "hardhat"
import {StakingManager, StakingManager__factory, LivepeerToken, LivepeerToken__factory} from "../../typechain"
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/dist/src/signers"
import {functionEncodedABI, functionSig} from "../../utils/helpers"
import chai from "chai"
import {solidity} from "ethereum-waffle"
import {constants} from "../../utils/constants"
import {BigNumberish} from "@ethersproject/bignumber"
chai.use(solidity)
const {expect} = chai

describe("StakingManager", () => {
    let fixture: Fixture
    let stakingManager: StakingManager
    let lpt: LivepeerToken

    const UNSTAKING_PERIOD = 2
    const NUM_ACTIVE_ORCHESTRATORS = 3

    let signers: SignerWithAddress[]

    before(async () => {
        signers = await ethers.getSigners()
        fixture = new Fixture(web3)
        await fixture.deploy()

        const llFac = await ethers.getContractFactory("SortedDoublyLL")
        const ll = await llFac.deploy()

        const stakingManagerFactory = await ethers.getContractFactory<StakingManager__factory>("StakingManager", {
            libraries: {
                SortedDoublyLL: ll.address
            }
        })
        stakingManager = await fixture.deployAndRegister(stakingManagerFactory, "StakingManager", fixture?.controller?.address)

        const lptFactory = new LivepeerToken__factory(signers[0])
        lpt = await fixture.deployAndRegister(lptFactory, "LivepeerToken")

        await stakingManager.setUnstakingPeriod(UNSTAKING_PERIOD)
        await stakingManager.setNumActiveOrchestrators(NUM_ACTIVE_ORCHESTRATORS)
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("StakingManager", () => {
        let orchestrator0: SignerWithAddress
        let orchestrator1: SignerWithAddress
        let orchestrator2: SignerWithAddress
        let delegator0: SignerWithAddress
        let delegator1: SignerWithAddress
        let delegator2: SignerWithAddress
        let thirdParty: SignerWithAddress
        let notControllerOwner: SignerWithAddress
        let controllerOwner: SignerWithAddress

        const currentRound = 100
        const stakeAmount = 10000
        const zeroAmount = 0

        before(async () => {
            controllerOwner = signers[0]
            notControllerOwner = signers[7]

            orchestrator0 = signers[1]
            orchestrator1 = signers[2]
            orchestrator2 = signers[3]

            delegator0 = signers[4]
            delegator1 = signers[5]
            delegator2 = signers[6]

            // migrator contract
            thirdParty = signers[7]

            const lptMintAmount = 1000000
            await lpt.mint(orchestrator0.address, lptMintAmount)
            await lpt.mint(orchestrator1.address, lptMintAmount)
            await lpt.mint(orchestrator2.address, lptMintAmount)
            await lpt.mint(delegator0.address, lptMintAmount)
            await lpt.mint(delegator1.address, lptMintAmount)
            await lpt.mint(delegator2.address, lptMintAmount)
            await lpt.mint(thirdParty.address, lptMintAmount)

            await lpt.connect(orchestrator0).approve(stakingManager.address, ethers.constants.MaxUint256)
            await lpt.connect(orchestrator1).approve(stakingManager.address, ethers.constants.MaxUint256)
            await lpt.connect(orchestrator2).approve(stakingManager.address, ethers.constants.MaxUint256)
            await lpt.connect(delegator0).approve(stakingManager.address, ethers.constants.MaxUint256)
            await lpt.connect(delegator1).approve(stakingManager.address, ethers.constants.MaxUint256)
            await lpt.connect(delegator2).approve(stakingManager.address, ethers.constants.MaxUint256)
            await lpt.connect(thirdParty).approve(stakingManager.address, ethers.constants.MaxUint256)
        })

        describe("Controller", () => {
            describe("setUnstakingPeriod", () => {
                it("should fail if caller is not Controller owner", async () => {
                    const tx = stakingManager.connect(notControllerOwner).setUnstakingPeriod(5)

                    await expect(tx).to.be.revertedWith("ONLY_CONTROLLER_OWNER")
                })

                it("should set unstakingPeriod", async () => {
                    const tx = stakingManager.connect(controllerOwner).setUnstakingPeriod(5)

                    await expect(tx).to.emit(stakingManager, "ParameterUpdate").withArgs("unstakingPeriod")
                    expect(await stakingManager.unstakingPeriod()).to.equal(5, "wrong unstakingPeriod")
                })
            })

            describe("setNumActiveOrchestrators", () => {
                it("should fail if caller is not Controller owner", async () => {
                    const tx = stakingManager.connect(notControllerOwner).setNumActiveOrchestrators(7)

                    await expect(tx).to.be.revertedWith("ONLY_CONTROLLER_OWNER")
                })

                it("should set numActiveOrchestrators", async () => {
                    const tx = stakingManager.connect(controllerOwner).setNumActiveOrchestrators(4)

                    await expect(tx).to.emit(stakingManager, "ParameterUpdate").withArgs("numActiveOrchestrators")
                    expect(await stakingManager.getOrchestratorPoolMaxSize()).to.equal(4, "wrong numActiveOrchestrators")
                })
            })
        })

        describe("Orchestrator", () => {
            before(async () => {
                await fixture?.roundsManager?.setMockBool(functionSig("currentRoundInitialized()"), true)
                await fixture?.roundsManager?.setMockBool(functionSig("currentRoundLocked()"), false)
                await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound - 1)

                await stakingManager.connect(orchestrator0).stake(stakeAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                await stakingManager.connect(orchestrator1).stake(stakeAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
            })

            describe("orchestrator pool", async () => {
                it("should get orchestrator max pool size", async () => {
                    const maxPoolSize = await stakingManager.getOrchestratorPoolMaxSize()

                    expect(maxPoolSize).to.equal(ethers.BigNumber.from(NUM_ACTIVE_ORCHESTRATORS))
                })

                it("should get orchestrator pool size", async () => {
                    const poolSize = await stakingManager.getOrchestratorPoolSize()

                    expect(poolSize).to.equal(ethers.BigNumber.from(2))
                })

                it("should get first orchestrator in pool", async () => {
                    const orchestrator = await stakingManager.getFirstOrchestratorInPool()

                    // should return the orchestrator with max stake
                    // or if all orchestrators have equal stake, return the latest
                    expect(orchestrator).to.equal(orchestrator1.address)
                })

                it("should get next orchestrator in pool", async () => {
                    const orchestrator = await stakingManager.getNextOrchestratorInPool(orchestrator1.address)

                    expect(orchestrator).to.equal(orchestrator0.address)
                })

                it("should check orchestrator status", async () => {
                    const status1 = await stakingManager.orchestratorStatus(orchestrator2.address)
                    const status2 = await stakingManager.orchestratorStatus(orchestrator0.address)

                    // 0 = NotRegistered = none of 1 or 2
                    // 1 = Registered = deactivated but stake of orch > 0
                    // 2 = Active = activationRound <= currentRound and deactivationRound > currentRound
                    expect(status1).to.equal(0)
                    expect(status2).to.equal(1)
                })

                it("should not set current round active stake if caller not roundsManager", async () => {
                    const tx = stakingManager.connect(thirdParty).setCurrentRoundTotalActiveStake()

                    await expect(tx).to.be.revertedWith("ONLY_ROUNDSMANAGER")
                })

                it("should check orchestrator status in next round", async () => {
                    await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound)

                    const status1 = await stakingManager.orchestratorStatus(orchestrator2.address)
                    const status2 = await stakingManager.orchestratorStatus(orchestrator0.address)

                    // 0 = NotRegistered = none of 1 or 2
                    // 1 = Registered = deactivated but stake of orch > 0
                    // 2 = Active = activationRound <= currentRound and deactivationRound > currentRound
                    expect(status1).to.equal(0)
                    expect(status2).to.equal(2)
                })

                describe("orchestrator is not already registered", () => {
                    it("should fail if caller is not delegated to self with a non-zero bonded amount", async () => {
                        await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + 1)
                        const tx = stakingManager.connect(orchestrator2).orchestrator(5, 10, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                        await expect(tx).to.be.revertedWith("ORCHESTRATOR_NOT_REGISTERED")
                    })

                    describe("orchestrator pool is not full", () => {
                        it("should add new orchestrator to the pool", async () => {
                            const poolSizeInitial = await stakingManager.getOrchestratorPoolSize()
                            expect(poolSizeInitial).to.equal(ethers.BigNumber.from(2))

                            const upcomingOrchestrator = signers[9]
                            await lpt.mint(upcomingOrchestrator.address, 1000000)
                            await lpt.connect(upcomingOrchestrator).approve(stakingManager.address, ethers.constants.MaxUint256)

                            await stakingManager.connect(upcomingOrchestrator).stake(stakeAmount + 1, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                            await stakingManager.connect(upcomingOrchestrator).orchestrator(5, 10, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                            const poolSizeLater = await stakingManager.getOrchestratorPoolSize()
                            expect(poolSizeLater).to.equal(ethers.BigNumber.from(3))

                            const status = await stakingManager.orchestratorStatus(upcomingOrchestrator.address)
                            expect(status).to.equal(1)
                        })
                    })

                    describe("orchestrator pool is full", async () => {
                        let upcomingOrchestrator: SignerWithAddress

                        beforeEach(async () => {
                            await stakingManager.connect(orchestrator0).orchestrator(5, 10, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                            await stakingManager.connect(orchestrator1).orchestrator(5, 10, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                            await stakingManager.connect(orchestrator2).stake(stakeAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                            await stakingManager.connect(orchestrator2).orchestrator(5, 10, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                            upcomingOrchestrator = signers[9]
                            await lpt.mint(upcomingOrchestrator.address, 1000000)
                            await lpt.connect(upcomingOrchestrator).approve(stakingManager.address, ethers.constants.MaxUint256)

                            await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound)
                        })

                        it("3 orchestrators should be active in the next round", async () => {
                            const orc0 = await stakingManager.isActiveOrchestrator(orchestrator0.address)
                            const orc1 = await stakingManager.isActiveOrchestrator(orchestrator1.address)
                            const orc2 = await stakingManager.isActiveOrchestrator(orchestrator2.address)

                            const poolSize = await stakingManager.getOrchestratorPoolSize()
                            expect(poolSize).to.equal(ethers.BigNumber.from(3))

                            expect(orc0).to.be.true
                            expect(orc1).to.be.true
                            expect(orc2).to.be.true
                        })

                        describe("caller has insufficient delegated stake to join pool", () => {
                            // 0 = NotRegistered = none of 1 or 2
                            // 1 = Registered = deactivated but stake of orch > 0
                            // 2 = Active = activationRound <= currentRound and deactivationRound > currentRound

                            it("should not add caller to pool", async () => {
                                // should not add caller to pool if delegation less than or equal to the least staked orchestrator already in pool
                                await stakingManager.connect(upcomingOrchestrator).stake(stakeAmount - 1, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                                const tx = stakingManager.connect(upcomingOrchestrator).orchestrator(5, 10, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                                await expect(tx).to.emit(stakingManager, "OrchestratorUpdate").withArgs(upcomingOrchestrator.address, 5, 10)

                                await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + 1)

                                const status = await stakingManager.isActiveOrchestrator(upcomingOrchestrator.address)
                                expect(status).to.be.false
                            })
                        })

                        describe("caller has sufficient delegated stake to join pool", () => {
                            it("should evict the orchestrator with least stake from the pool", async () => {
                                await stakingManager.connect(orchestrator0).stake(1, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                                await stakingManager.connect(orchestrator2).stake(2, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                                // make it so
                                // orchestrator0's stake = stakeAmount + 1
                                // orchestrator1's stake = stakeAmount
                                // orchestrator2's stake = stakeAmount + 2
                                // upcomingOrchestrator's stake = stakeAmount + 3

                                await stakingManager.connect(upcomingOrchestrator).stake(stakeAmount + 3, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                                const tx = stakingManager.connect(upcomingOrchestrator).orchestrator(5, 10, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                                await expect(tx).to.emit(stakingManager, "OrchestratorUpdate").withArgs(upcomingOrchestrator.address, 5, 10)

                                await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + 1)

                                const status = await stakingManager.isActiveOrchestrator(upcomingOrchestrator.address)
                                expect(status).to.be.true

                                const statusEvicted = await stakingManager.isActiveOrchestrator(orchestrator1.address)
                                expect(statusEvicted).to.be.false
                            })

                            it("should evict the oldest orchestrator if all existing have equal stake", async () => {
                                await stakingManager.connect(upcomingOrchestrator).stake(stakeAmount + 1, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                                const tx = stakingManager.connect(upcomingOrchestrator).orchestrator(5, 10, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                                await expect(tx).to.emit(stakingManager, "OrchestratorUpdate").withArgs(upcomingOrchestrator.address, 5, 10)

                                await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + 1)

                                const status = await stakingManager.isActiveOrchestrator(upcomingOrchestrator.address)
                                expect(status).to.be.true

                                const statusEvicted = await stakingManager.isActiveOrchestrator(orchestrator0.address)
                                expect(statusEvicted).to.be.false
                            })
                        })
                    })

                    describe("orchestrator is already registered", () => {
                        it("should return correct status - registered", async () => {
                            const status = await stakingManager.orchestratorStatus(orchestrator0.address)
                            expect(status).to.equal(1)
                        })

                        it("should fail if current round is not initialized", async () => {
                            await fixture?.roundsManager?.setMockBool(functionSig("currentRoundInitialized()"), false)
                            const tx = stakingManager.connect(orchestrator0).orchestrator(5, 10, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                            await expect(tx).to.be.revertedWith("CURRENT_ROUND_NOT_INITIALIZED")
                        })

                        it("should fail if the current round is locked", async () => {
                            await fixture?.roundsManager?.setMockBool(functionSig("currentRoundLocked()"), true)
                            const tx = stakingManager.connect(orchestrator0).orchestrator(5, 10, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                            await expect(tx).to.be.revertedWith("CURRENT_ROUND_LOCKED")
                        })

                        it("should fail if rewardCut is not a valid percentage <= 100%", async () => {
                            await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound)
                            const tx = stakingManager.connect(orchestrator0).orchestrator(constants.PERC_DIVISOR_PRECISE.add(1), 10, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                            await expect(tx).to.be.revertedWith("REWARDSHARE_INVALID_PERC")
                        })

                        it("should fail if feeShare is not a valid percentage <= 100%", async () => {
                            await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound)
                            const tx = stakingManager.connect(orchestrator0).orchestrator(5, constants.PERC_DIVISOR_PRECISE.add(1), constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                            await expect(tx).to.be.revertedWith("FEESHARE_INVALID_PERC")
                        })

                        it("should make changes to its commission rates", async () => {
                            const oInfoInitial = await stakingManager.getOrchestrator(orchestrator0.address)

                            expect(oInfoInitial.rewardShare).to.equal(0)
                            expect(oInfoInitial.feeShare).to.equal(0)

                            await stakingManager.connect(orchestrator0).orchestrator(6, 11, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                            const oInfo = await stakingManager.getOrchestrator(orchestrator0.address)

                            expect(oInfo.rewardShare).to.equal(6)
                            expect(oInfo.feeShare).to.equal(11)
                        })
                    })

                    describe("orchestrator is active", () => {
                        before(async () => {
                            await stakingManager.connect(orchestrator0).orchestrator(5, 10, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                            await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound)
                            await fixture?.roundsManager?.execute(stakingManager.address, functionSig("setCurrentRoundTotalActiveStake()"))
                        })

                        it("should return correct status - active", async () => {
                            const status = await stakingManager.orchestratorStatus(orchestrator0.address)
                            expect(status).to.equal(2)
                        })

                        it("should fail to changes its commission if active and not called reward", async () => {
                            const tx = stakingManager.connect(orchestrator0).orchestrator(6, 11, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                            expect(tx).to.be.revertedWith("COMMISSION_RATES_LOCKED")
                        })

                        it("should make changes to its commission rates after calling reward", async () => {
                            const oInfoInitial = await stakingManager.getOrchestrator(orchestrator0.address)

                            expect(oInfoInitial.rewardShare).to.equal(5)
                            expect(oInfoInitial.feeShare).to.equal(10)

                            await stakingManager.connect(orchestrator0).reward(constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                            await stakingManager.connect(orchestrator0).orchestrator(6, 11, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                            const oInfo = await stakingManager.getOrchestrator(orchestrator0.address)

                            expect(oInfo.rewardShare).to.equal(6)
                            expect(oInfo.feeShare).to.equal(11)
                        })
                    })
                })
            })

            describe("stake", async () => {
                before(async () => {
                    await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound)
                    await fixture?.roundsManager?.execute(stakingManager.address, functionSig("setCurrentRoundTotalActiveStake()"))
                })

                it("should get total stake for the current round", async () => {
                    const stake0 = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                    const stake1 = await stakingManager.orchestratorTotalStake(orchestrator1.address)
                    const total = stake0.add(stake1)

                    const roundTotalStake = await stakingManager.getTotalStaked()

                    expect(roundTotalStake).to.equal(total)
                })

                describe("orchestrator is increasing its delegation", async () => {
                    it("should fail if current round is not initialized", async () => {
                        await fixture?.roundsManager?.setMockBool(functionSig("currentRoundInitialized()"), false)
                        const tx = stakingManager.connect(orchestrator0).stake(stakeAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                        await expect(tx).to.be.revertedWith("CURRENT_ROUND_NOT_INITIALIZED")
                    })

                    it("should fail if orchestrator tries to delegate to itself", async () => {
                        const tx = stakingManager.connect(orchestrator0).delegate(stakeAmount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                        await expect(tx).to.be.revertedWith("CANNOT_SELF_DELEGATE")
                    })

                    it("should fail if insufficient available balance", async () => {
                        const balance = await lpt.balanceOf(orchestrator0.address)
                        const tx = stakingManager.connect(orchestrator0).stake(balance.add(1000), constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                        await expect(tx).to.be.revertedWith("ERC20: transfer amount exceeds balance")
                    })

                    it("should fail if stake amount exceeds max value of int256", async () => {
                        const tx = stakingManager.connect(orchestrator0).stake(ethers.BigNumber.from(2).pow(255), constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                        await expect(tx).to.be.revertedWith("AMOUNT_OVERFLOW")
                    })

                    it("should increases stake for itself", async () => {
                        const currentStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                        await stakingManager.connect(orchestrator0).stake(stakeAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                        // orchestrators stake towards itself
                        const orchestratorsStake = await stakingManager.getDelegatedStake(orchestrator0.address, orchestrator0.address)
                        // total tokens staked towards orchestrator
                        const newStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)

                        expect(orchestratorsStake).to.equal(currentStake.add(stakeAmount))
                        expect(newStake).to.equal(currentStake.add(stakeAmount))
                    })

                    it("should fire a Stake event when staking", async () => {
                        const tx = await stakingManager.connect(orchestrator0).stake(stakeAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                        expect(tx).to.emit(stakingManager, "Stake").withArgs(orchestrator0.address, stakeAmount)
                    })
                })

                describe("rewards eligibility", async () => {
                    // staked tokens only get active for rewards after the next round starts and pool is updated
                    it("stake should not be active immediately", async () => {
                        const currentTotalStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                        expect(currentTotalStake).to.equal(stakeAmount)

                        const currentActiveStake = await stakingManager.orchestratorActiveStake(orchestrator0.address)
                        expect(currentActiveStake).to.equal(0)
                    })

                    describe("next round starts but pool is not updated", async () => {
                        it("total stake should change but active stake should not change", async () => {
                            await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + 1)
                            await fixture?.roundsManager?.execute(stakingManager.address, functionSig("setCurrentRoundTotalActiveStake()"))

                            const currentTotalStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                            expect(currentTotalStake).to.equal(stakeAmount)

                            const currentActiveStake = await stakingManager.orchestratorActiveStake(orchestrator0.address)
                            expect(currentActiveStake).to.equal(0)
                        })
                    })

                    describe("next round starts and pool is updated with 0 amount", async () => {
                        it("total stake and active stake should change", async () => {
                            await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + 1)
                            await fixture?.roundsManager?.execute(stakingManager.address, functionSig("setCurrentRoundTotalActiveStake()"))

                            const tx = stakingManager.connect(orchestrator0).stake(0, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                            await expect(tx).to.not.be.reverted

                            const currentTotalStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                            expect(currentTotalStake).to.equal(stakeAmount)

                            const currentActiveStake = await stakingManager.orchestratorActiveStake(orchestrator0.address)
                            expect(currentActiveStake).to.equal(stakeAmount)
                        })
                    })

                    describe("next round starts and pool is updated with non zero amount", async () => {
                        it("total stake and active stake should change", async () => {
                            await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + 1)
                            await fixture?.roundsManager?.execute(stakingManager.address, functionSig("setCurrentRoundTotalActiveStake()"))

                            await stakingManager.connect(orchestrator0).stake(stakeAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                            const currentTotalStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                            expect(currentTotalStake).to.equal(stakeAmount + stakeAmount)

                            const currentActiveStake = await stakingManager.orchestratorActiveStake(orchestrator0.address)
                            expect(currentActiveStake).to.equal(stakeAmount)
                        })
                    })
                })
            })

            describe("unstake", async () => {
                const unstakingAmount = 5000

                before(async () => {
                    await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound)
                    await fixture?.roundsManager?.execute(stakingManager.address, functionSig("setCurrentRoundTotalActiveStake()"))
                })

                describe("orchestrator is in active set", async () => {
                    it("should fail if current round is not initialized", async () => {
                        await fixture?.roundsManager?.setMockBool(functionSig("currentRoundInitialized()"), false)
                        const tx = stakingManager.connect(orchestrator0).unstake(unstakingAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                        await expect(tx).to.be.revertedWith("CURRENT_ROUND_NOT_INITIALIZED")
                    })

                    it("should fail requested amount exceeds staked amount", async () => {
                        const excessAmount = stakeAmount + 1000
                        const tx = stakingManager.connect(orchestrator0).unstake(excessAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                        await expect(tx).to.be.revertedWith("AMOUNT_EXCEEDS_STAKE")
                    })

                    it("should fail if unstake amount exceeds max value of int256", async () => {
                        const tx = stakingManager.connect(orchestrator0).unstake(ethers.BigNumber.from(2).pow(255), constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                        await expect(tx).to.be.revertedWith("AMOUNT_OVERFLOW")
                    })

                    describe("partial unstake", async () => {
                        const partialAmount = stakeAmount - 1000

                        describe("in the same round", async () => {
                            it("should unstake partially", async () => {
                                const initialTotalStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                                const orchestratorInitialStake = await stakingManager.getDelegatedStake(orchestrator0.address, orchestrator0.address)

                                await stakingManager.connect(orchestrator0).unstake(partialAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                                const totalStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                                const orchestratorsStake = await stakingManager.getDelegatedStake(orchestrator0.address, orchestrator0.address)

                                expect(orchestratorsStake).to.equal(orchestratorInitialStake.sub(partialAmount))
                                expect(totalStake).to.equal(initialTotalStake.sub(partialAmount))
                            })

                            it("should fire a Unstake event when unstaking", async () => {
                                const tx = stakingManager.connect(orchestrator0).unstake(partialAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                                await expect(tx).to.emit(stakingManager, "Unstake").withArgs(orchestrator0.address, partialAmount, 0)
                            })

                            it("should update active stake and total stake on unstake", async () => {
                                const initialTotalStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                                const initialActiveStake = await stakingManager.orchestratorActiveStake(orchestrator0.address)

                                expect(initialActiveStake).to.equal(0)

                                await stakingManager.connect(orchestrator0).unstake(partialAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                                const TotalStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                                const ActiveStake = await stakingManager.orchestratorActiveStake(orchestrator0.address)

                                expect(TotalStake).to.equal(initialTotalStake.sub(partialAmount))
                                expect(ActiveStake).to.equal(1000)
                            })

                            it("should decrease the total stake for the next round", async () => {
                                const startTotalStake = await stakingManager.nextRoundTotalActiveStake()
                                await stakingManager.connect(orchestrator0).unstake(partialAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                                const endTotalStake = await stakingManager.nextRoundTotalActiveStake()

                                expect(startTotalStake.sub(endTotalStake)).to.equal(partialAmount)
                            })
                        })

                        describe("in next round after pool update", async () => {
                            beforeEach(async () => {
                                await fixture?.roundsManager?.setMockBool(functionSig("currentRoundInitialized()"), true)
                                await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + 1)
                                await stakingManager.connect(orchestrator0).stake(0, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                            })

                            it("should update active stake and total stake on unstake", async () => {
                                // when unstaking occurs both stake and nextStake is changed so that it is not eligible for reward
                                const initialTotalStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                                const initialActiveStake = await stakingManager.orchestratorActiveStake(orchestrator0.address)

                                expect(initialActiveStake).to.equal(initialTotalStake)

                                await stakingManager.connect(orchestrator0).unstake(partialAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                                const TotalStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                                const ActiveStake = await stakingManager.orchestratorActiveStake(orchestrator0.address)

                                expect(TotalStake).to.equal(initialTotalStake.sub(partialAmount))
                                expect(ActiveStake).to.equal(1000)
                            })
                        })
                    })

                    describe("full unstake", async () => {
                        it("should unstake fully", async () => {
                            const fullAmount = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                            const tx = stakingManager.connect(orchestrator0).unstake(fullAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                            await expect(tx)
                                .to.emit(stakingManager, "OrchestratorDeactivated")
                                .withArgs(orchestrator0.address, currentRound + 1)
                        })

                        it("should deactivate after unstaking fully in the next round", async () => {
                            const fullAmount = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                            await stakingManager.connect(orchestrator0).unstake(fullAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                            await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + 1)
                            const status = await stakingManager.orchestratorStatus(orchestrator0.address)

                            // 0 = NotRegistered,
                            // 1 = Registered,
                            // 2 = Active
                            expect(status).to.equal(0)
                        })

                        it("should fail if no stakes", async () => {
                            const fullAmount = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                            await stakingManager.connect(orchestrator0).unstake(fullAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                            const tx = stakingManager.connect(orchestrator0).unstake(fullAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                            await expect(tx).to.be.revertedWith("CALLER_NOT_STAKED")
                        })
                    })
                })

                describe("when orchestrator not in active set", async () => {
                    const partialAmount = stakeAmount - 1000

                    beforeEach(async () => {
                        await stakingManager.connect(orchestrator2).stake(stakeAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                        await stakingManager.connect(orchestrator2).orchestrator(5, 10, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                        const orchestrator3 = signers[9]
                        await lpt.mint(orchestrator3.address, 1000000)
                        await lpt.connect(orchestrator3).approve(stakingManager.address, ethers.constants.MaxUint256)

                        await stakingManager.connect(orchestrator3).stake(stakeAmount + 1, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                        await stakingManager.connect(orchestrator3).orchestrator(5, 10, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                        await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + 1)

                        //                          stake
                        // orchestrator0's stake = (stakeAmount)
                        // orchestrator1's stake = (stakeAmount)
                        // orchestrator2's stake = (stakeAmount)
                        // orchestrator3's stake = (stakeAmount + 1)

                        // evicts orchestrator 0
                    })

                    it("orchestrator should not be active", async () => {
                        const status = await stakingManager.isActiveOrchestrator(orchestrator0.address)
                        expect(status).to.be.false
                    })

                    it("should partially unstake", async () => {
                        const initialTotalStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                        const orchestratorInitialStake = await stakingManager.getDelegatedStake(orchestrator0.address, orchestrator0.address)

                        await stakingManager.connect(orchestrator0).unstake(partialAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                        const totalStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                        const orchestratorsStake = await stakingManager.getDelegatedStake(orchestrator0.address, orchestrator0.address)

                        expect(orchestratorsStake).to.equal(orchestratorInitialStake.sub(partialAmount))
                        expect(totalStake).to.equal(initialTotalStake.sub(partialAmount))
                    })

                    // TODO - what happens to the delegator's pool if inactive orchestrator unstakes

                    it("should not update total active stake for the next round", async () => {
                        const startTotalStake = await stakingManager.nextRoundTotalActiveStake()
                        await stakingManager.connect(orchestrator0).unstake(partialAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                        const endTotalStake = await stakingManager.nextRoundTotalActiveStake()

                        expect(startTotalStake.sub(endTotalStake)).to.equal(0)
                    })
                })
            })

            describe("restake", async () => {
                let unstakingLockID: BigNumberish
                const unstakeAmount = stakeAmount / 2

                beforeEach(async () => {
                    await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound)
                    const tx = await stakingManager.connect(orchestrator0).unstake(unstakeAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    const events = await stakingManager.queryFilter(stakingManager.filters.Unstake(), tx.blockHash)
                    unstakingLockID = events[0].args.lockID
                })

                it("should fail for invalid unstakingLockID", async () => {
                    const unstakingLockID = 1234
                    const tx = stakingManager.connect(orchestrator0).restake(unstakingLockID, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("INVALID_UNSTAKING_LOCK_ID")
                })

                it("should fail if not lock owner", async () => {
                    const tx = stakingManager.connect(orchestrator1).restake(unstakingLockID, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("CALLER_NOT_LOCK_OWNER")
                })

                it("should restake to itself", async () => {
                    await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound)

                    const prevStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                    await stakingManager.connect(orchestrator0).restake(unstakingLockID, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    const newStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)

                    expect(prevStake).to.equal(unstakeAmount)
                    expect(newStake).to.equal(stakeAmount)
                })
            })

            describe("withdraw", async () => {
                describe("withdrawStake", async () => {
                    let unstakingLockID: BigNumberish
                    const withdrawAmount = stakeAmount / 2

                    beforeEach(async () => {
                        await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + 1)
                        const tx = await stakingManager.connect(orchestrator0).unstake(withdrawAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                        const events = await stakingManager.queryFilter(stakingManager.filters.Unstake(), tx.blockHash)
                        unstakingLockID = events[0].args.lockID
                    })

                    it("should fail if system is paused", async () => {
                        await fixture?.controller?.pause()
                        const tx = stakingManager.connect(orchestrator0).withdrawStake(unstakingLockID)

                        await expect(tx).to.be.revertedWith("SYSTEM_PAUSED")
                    })

                    it("should fail if current round is not initialized", async () => {
                        await fixture?.roundsManager?.setMockBool(functionSig("currentRoundInitialized()"), false)
                        const tx = stakingManager.connect(orchestrator0).withdrawStake(unstakingLockID)

                        await expect(tx).to.be.revertedWith("CURRENT_ROUND_NOT_INITIALIZED")
                    })

                    it("should fail for invalid unstakingLockID", async () => {
                        const unstakingLockID = 1234
                        const tx = stakingManager.connect(orchestrator0).withdrawStake(unstakingLockID)

                        await expect(tx).to.be.revertedWith("INVALID_UNSTAKING_LOCK_ID")
                    })

                    it("should fail if unbonding lock withdraw round is in the future", async () => {
                        const tx = stakingManager.connect(orchestrator0).withdrawStake(unstakingLockID)

                        await expect(tx).revertedWith("WITHDRAW_ROUND_NOT_REACHED_YET")
                    })

                    it("should fail if not lock owner", async () => {
                        const unstakingPeriod = await stakingManager.unstakingPeriod()
                        await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + 1 + unstakingPeriod.toNumber())

                        const tx = stakingManager.connect(orchestrator1).withdrawStake(unstakingLockID)

                        await expect(tx).to.be.revertedWith("CALLER_NOT_LOCK_OWNER")
                    })

                    it("should withdraw stake", async () => {
                        const unstakingPeriod = await stakingManager.unstakingPeriod()
                        await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + 1 + unstakingPeriod.toNumber())

                        const prevLock = await stakingManager.unstakingLocks(unstakingLockID)
                        await stakingManager.connect(orchestrator0).withdrawStake(unstakingLockID)
                        const newLock = await stakingManager.unstakingLocks(unstakingLockID)

                        expect(prevLock.amount).to.eq(withdrawAmount)
                        expect(newLock.amount).to.eq(0)
                    })

                    it("should fire a WithdrawStake event when withdrawing stake", async () => {
                        const unstakingPeriod = await stakingManager.unstakingPeriod()
                        await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + 1 + unstakingPeriod.toNumber())

                        const tx = stakingManager.connect(orchestrator0).withdrawStake(unstakingLockID)

                        await expect(tx)
                            .to.emit(stakingManager, "WithdrawStake")
                            .withArgs(orchestrator0.address, unstakingLockID, withdrawAmount, currentRound + 1 + unstakingPeriod.toNumber())
                    })
                })

                describe("withdrawFees", async () => {
                    beforeEach(async () => {
                        await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + 1)
                        await expect(fixture?.ticketBroker?.execute(stakingManager.address, functionEncodedABI("updateOrchestratorWithFees(address,uint256)", ["address", "uint256"], [orchestrator0.address, 1000])))
                    })

                    it("should get correct amount of fees", async () => {
                        await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + 2)
                        const fees = await stakingManager.feesOf(orchestrator0.address, orchestrator0.address)
                        expect(fees).to.equal(1000)
                    })

                    it("should withdraw fees", async () => {
                        await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + 2)
                        await stakingManager.withdrawFees(orchestrator0.address)
                    })
                })
            })

            describe("third party", async () => {
                it("stakeFor", async () => {
                    const currentStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                    await stakingManager.connect(thirdParty).stakeFor(stakeAmount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    const newStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)

                    expect(newStake).to.equal(currentStake.add(stakeAmount))
                })

                it("should fail to call delegateFor to orchestrator on behalf of same orchestrator", async () => {
                    const tx = stakingManager.connect(thirdParty).delegateFor(stakeAmount, orchestrator0.address, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("CANNOT_SELF_DELEGATE")
                })
            })
        })

        describe("Delegator", () => {
            describe("delegate", () => {
                it("should fail if current round is not initialized", async () => {
                    await fixture?.roundsManager?.setMockBool(functionSig("currentRoundInitialized()"), false)
                    const tx = stakingManager.connect(delegator0).delegate(stakeAmount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("CURRENT_ROUND_NOT_INITIALIZED")
                })

                it("should fail if delegating to self", async () => {
                    const tx = stakingManager.connect(delegator0).delegate(stakeAmount, delegator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("CANNOT_SELF_DELEGATE")
                })

                it("should delegate towards an orchestrator", async () => {
                    const currentStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                    await stakingManager.connect(delegator0).delegate(stakeAmount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    const newStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)

                    expect(newStake).to.gte(currentStake.add(stakeAmount).sub(1))
                    expect(await stakingManager.getDelegatedStake(orchestrator0.address, delegator0.address)).to.be.gte(ethers.BigNumber.from(stakeAmount).sub(1))
                })

                it("should fire a Delegate event when delegating", async () => {
                    const tx = await stakingManager.connect(delegator0).delegate(stakeAmount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    expect(tx).to.emit(stakingManager, "Delegate").withArgs(delegator0.address, orchestrator0.address, stakeAmount)
                })

                it("should correctly update details", async () => {
                    await stakingManager.connect(delegator0).delegate(stakeAmount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    const dInfo = await stakingManager.connect(delegator0).getDelegation(orchestrator0.address, delegator0.address)

                    expect(dInfo.totalStake).to.equal(stakeAmount)
                    expect(dInfo.lastUpdateRound).to.equal(currentRound)
                })
            })

            describe("changeDelegation", () => {
                const changeAmount = 50

                beforeEach(async () => {
                    await stakingManager.connect(delegator0).delegate(100, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    await stakingManager.connect(delegator0).delegate(101, orchestrator1.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                })

                it("should fail if change delegation amount = 0", async () => {
                    const tx = stakingManager.connect(delegator0).changeDelegation(zeroAmount, orchestrator0.address, orchestrator1.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("ZERO_CHANGE_DELEGATION_AMOUNT")
                })

                it("should fail if delegator changes delegation for self", async () => {
                    const tx = stakingManager.connect(delegator0).changeDelegation(changeAmount, delegator0.address, orchestrator1.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("CANNOT_CHANGE_DELEGATION_FOR_SELF")
                })

                it("should fail if orchestrator changes delegation for self", async () => {
                    const tx = stakingManager.connect(orchestrator0).changeDelegation(changeAmount, orchestrator0.address, orchestrator1.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("CANNOT_CHANGE_DELEGATION_FOR_SELF")
                })

                describe("orchestrator is in active set", () => {
                    it("should change delegation to another orchestrator", async () => {
                        const currentStake0 = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                        const currentStake1 = await stakingManager.orchestratorTotalStake(orchestrator1.address)

                        const delegatorShare0 = await stakingManager.getDelegatedStake(orchestrator0.address, delegator0.address)
                        const delegatorShare1 = await stakingManager.getDelegatedStake(orchestrator1.address, delegator0.address)

                        await stakingManager.connect(delegator0).changeDelegation(changeAmount, orchestrator0.address, orchestrator1.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                        const newStake0 = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                        const newStake1 = await stakingManager.orchestratorTotalStake(orchestrator1.address)

                        expect(newStake0).to.equal(currentStake0.sub(changeAmount))
                        expect(newStake1).to.equal(currentStake1.add(changeAmount))
                        expect(await stakingManager.getDelegatedStake(orchestrator0.address, delegator0.address)).to.be.gte(delegatorShare0.sub(changeAmount).sub(1))
                        expect(await stakingManager.getDelegatedStake(orchestrator1.address, delegator0.address)).to.be.gte(delegatorShare1.add(changeAmount).sub(1))
                    })
                })

                describe("orchestrator is not in active set", () => {
                    beforeEach(async () => {
                        await stakingManager.connect(orchestrator2).stake(stakeAmount + 200, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                        await stakingManager.connect(orchestrator2).orchestrator(5, 10, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                        const orchestrator3 = signers[9]
                        await lpt.mint(orchestrator3.address, 1000000)
                        await lpt.connect(orchestrator3).approve(stakingManager.address, ethers.constants.MaxUint256)

                        await stakingManager.connect(orchestrator3).stake(stakeAmount + 201, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                        await stakingManager.connect(orchestrator3).orchestrator(5, 10, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                        await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + 1)

                        //                          stake                  delegation
                        // orchestrator0's stake = (stakeAmount)        +  100
                        // orchestrator1's stake = (stakeAmount)        +  101
                        // orchestrator2's stake = (stakeAmount + 200)
                        // orchestrator3's stake = (stakeAmount + 201)

                        // evicts orchestrator 0
                    })

                    it("should change delegation to another orchestrator", async () => {
                        const currentStake0 = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                        const currentStake1 = await stakingManager.orchestratorTotalStake(orchestrator1.address)

                        const delegatorShare0 = await stakingManager.getDelegatedStake(orchestrator0.address, delegator0.address)
                        const delegatorShare1 = await stakingManager.getDelegatedStake(orchestrator1.address, delegator0.address)

                        await stakingManager.connect(delegator0).changeDelegation(changeAmount, orchestrator0.address, orchestrator1.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                        const newStake0 = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                        const newStake1 = await stakingManager.orchestratorTotalStake(orchestrator1.address)

                        expect(newStake0).to.equal(currentStake0.sub(changeAmount))
                        expect(newStake1).to.equal(currentStake1.add(changeAmount))
                        expect(await stakingManager.getDelegatedStake(orchestrator0.address, delegator0.address)).to.be.gte(delegatorShare0.sub(changeAmount).sub(1))
                        expect(await stakingManager.getDelegatedStake(orchestrator1.address, delegator0.address)).to.be.gte(delegatorShare1.add(changeAmount).sub(1))
                    })
                })
            })

            describe("undelegate", () => {
                beforeEach(async () => {
                    await stakingManager.connect(delegator0).delegate(stakeAmount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                })

                it("should undelegate amount from an orchestrator", async () => {
                    const currentStake = await stakingManager.getDelegatedStake(orchestrator0.address, delegator0.address)
                    await stakingManager.connect(delegator0).undelegate(stakeAmount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    const newStake = await stakingManager.getDelegatedStake(orchestrator0.address, delegator0.address)

                    expect(newStake).to.gte(currentStake.sub(stakeAmount).sub(1))
                })

                it("should fire an Undelegate event when undelegating", async () => {
                    const tx = stakingManager.connect(delegator0).undelegate(stakeAmount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.emit(stakingManager, "Undelegate").withArgs(delegator0.address, orchestrator0.address, stakeAmount, 0)
                })
            })

            describe("redelegate", () => {
                let unstakingLockID: BigNumberish
                const undelegateAmount = stakeAmount / 2

                beforeEach(async () => {
                    await stakingManager.connect(delegator0).delegate(stakeAmount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    const tx = await stakingManager.connect(delegator0).undelegate(undelegateAmount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    const events = await stakingManager.queryFilter(stakingManager.filters.Undelegate(), tx.blockHash)
                    unstakingLockID = events[0].args.lockID
                })

                it("should fail for invalid unstakingLockID", async () => {
                    const unstakingLockID = 1234
                    const tx = stakingManager.connect(delegator0).redelegate(unstakingLockID, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("INVALID_UNSTAKING_LOCK_ID")
                })

                it("should fail if not lock owner", async () => {
                    const tx = stakingManager.connect(delegator1).redelegate(unstakingLockID, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("CALLER_NOT_LOCK_OWNER")
                })

                it("should redelegate amount to an orchestrator", async () => {
                    const prevStake = await stakingManager.getDelegatedStake(orchestrator0.address, delegator0.address)
                    await stakingManager.connect(delegator0).redelegate(unstakingLockID, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    const newStake = await stakingManager.getDelegatedStake(orchestrator0.address, delegator0.address)

                    expect(prevStake).to.gte(ethers.BigNumber.from(undelegateAmount).sub(1))
                    expect(newStake).to.gte(ethers.BigNumber.from(stakeAmount).sub(1))
                })
            })

            describe("withdraw", async () => {
                let unstakingLockID: BigNumberish
                const withdrawAmount = stakeAmount / 2

                beforeEach(async () => {
                    await stakingManager.connect(delegator0).delegate(stakeAmount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + 1)
                    const tx = await stakingManager.connect(delegator0).undelegate(withdrawAmount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    const events = await stakingManager.queryFilter(stakingManager.filters.Undelegate(), tx.blockHash)
                    unstakingLockID = events[0].args.lockID
                })

                it("should fail if system is paused", async () => {
                    await fixture?.controller?.pause()
                    const tx = stakingManager.connect(delegator0).withdrawStake(unstakingLockID)

                    await expect(tx).to.be.revertedWith("SYSTEM_PAUSED")
                })

                it("should fail if current round is not initialized", async () => {
                    await fixture?.roundsManager?.setMockBool(functionSig("currentRoundInitialized()"), false)
                    const tx = stakingManager.connect(delegator0).withdrawStake(unstakingLockID)

                    await expect(tx).to.be.revertedWith("CURRENT_ROUND_NOT_INITIALIZED")
                })

                it("should fail for invalid unstakingLockID", async () => {
                    const unstakingLockID = 1234
                    const tx = stakingManager.connect(delegator0).withdrawStake(unstakingLockID)

                    await expect(tx).to.be.revertedWith("INVALID_UNSTAKING_LOCK_ID")
                })

                it("should fail if unbonding lock withdraw round is in the future", async () => {
                    const tx = stakingManager.connect(delegator1).withdrawStake(unstakingLockID)

                    await expect(tx).revertedWith("WITHDRAW_ROUND_NOT_REACHED_YET")
                })

                it("should fail if not lock owner", async () => {
                    const unstakingPeriod = await stakingManager.unstakingPeriod()
                    await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + 1 + unstakingPeriod.toNumber())

                    const tx = stakingManager.connect(delegator1).withdrawStake(unstakingLockID)

                    await expect(tx).to.be.revertedWith("CALLER_NOT_LOCK_OWNER")
                })

                it("should withdraw stake", async () => {
                    const unstakingPeriod = await stakingManager.unstakingPeriod()
                    await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + 1 + unstakingPeriod.toNumber())

                    const prevLock = await stakingManager.unstakingLocks(unstakingLockID)
                    await stakingManager.connect(delegator0).withdrawStake(unstakingLockID)
                    const newLock = await stakingManager.unstakingLocks(unstakingLockID)

                    expect(prevLock.amount).to.eq(withdrawAmount)
                    expect(newLock.amount).to.eq(0)
                })

                it("should fire a WithdrawStake event when withdrawing stake", async () => {
                    const unstakingPeriod = await stakingManager.unstakingPeriod()
                    await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + 1 + unstakingPeriod.toNumber())

                    const tx = stakingManager.connect(delegator0).withdrawStake(unstakingLockID)

                    await expect(tx)
                        .to.emit(stakingManager, "WithdrawStake")
                        .withArgs(delegator0.address, unstakingLockID, withdrawAmount, currentRound + 1 + unstakingPeriod.toNumber())
                })
            })

            describe("third party", async () => {
                it("should delegate on behalf of delegator", async () => {
                    const currentStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                    await stakingManager.connect(thirdParty).delegateFor(stakeAmount, orchestrator0.address, delegator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    const newStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)

                    expect(newStake).to.equal(currentStake.add(stakeAmount))
                    expect(await stakingManager.getDelegatedStake(orchestrator0.address, delegator0.address)).to.be.gte(ethers.BigNumber.from(stakeAmount).sub(1))
                    expect(await stakingManager.getDelegatedStake(orchestrator0.address, thirdParty.address)).to.be.gte(ethers.BigNumber.from(0).sub(1))
                })
            })
        })

        // describe("Rewards", async () => {
        //     beforeEach(async () => {
        //         await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + 1)
        //         await fixture?.minter?.setMockUint256(functionSig("createReward(uint256,uint256)"), 1000)
        //     })

        //     it("should fail if system is paused", async () => {
        //         await fixture?.controller?.pause()

        //         await expect(stakingManager.connect(orchestrator0).reward(constants.NULL_ADDRESS, constants.NULL_ADDRESS)).to.be.revertedWith("SYSTEM_PAUSED")
        //     })

        //     it("should fail if current round is not initialized", async () => {
        //         await fixture?.roundsManager?.setMockBool(functionSig("currentRoundInitialized()"), false)

        //         await expect(stakingManager.connect(orchestrator0).reward(constants.NULL_ADDRESS, constants.NULL_ADDRESS)).to.be.revertedWith("CURRENT_ROUND_NOT_INITIALIZED")
        //     })

        //     it("should fail if caller is not an active orchestrator for the current round", async () => {
        //         await expect(stakingManager.connect(thirdParty).reward(constants.NULL_ADDRESS, constants.NULL_ADDRESS)).to.be.revertedWith("ORCHESTRATOR_NOT_ACTIVE")
        //     })

        //     it("should fail if caller already called reward during the current round", async () => {
        //         await stakingManager.connect(orchestrator0).reward(constants.NULL_ADDRESS, constants.NULL_ADDRESS)
        //         // This should fail because orchestrator already called reward during the current round
        //         await expect(stakingManager.connect(orchestrator0).reward(constants.NULL_ADDRESS, constants.NULL_ADDRESS)).to.be.revertedWith("ALREADY_CALLED_REWARD_FOR_CURRENT_ROUND")
        //     })

        //     it("should update caller with rewards", async () => {})
        // })
    })
})
