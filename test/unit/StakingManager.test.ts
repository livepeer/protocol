import Fixture from "./helpers/Fixture"
import {web3, ethers} from "hardhat"
import {StakingManager, StakingManager__factory, LivepeerToken, LivepeerToken__factory} from "../../typechain"
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/dist/src/signers"
import {functionSig} from "../../utils/helpers"
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

            // migrator contract
            thirdParty = signers[6]

            const lptMintAmount = 1000000
            await lpt.mint(orchestrator0.address, lptMintAmount)
            await lpt.mint(orchestrator1.address, lptMintAmount)
            await lpt.mint(orchestrator2.address, lptMintAmount)
            await lpt.mint(delegator0.address, lptMintAmount)
            await lpt.mint(delegator1.address, lptMintAmount)
            await lpt.mint(thirdParty.address, lptMintAmount)

            await lpt.connect(orchestrator0).approve(stakingManager.address, ethers.constants.MaxUint256)
            await lpt.connect(orchestrator1).approve(stakingManager.address, ethers.constants.MaxUint256)
            await lpt.connect(orchestrator2).approve(stakingManager.address, ethers.constants.MaxUint256)
            await lpt.connect(delegator0).approve(stakingManager.address, ethers.constants.MaxUint256)
            await lpt.connect(delegator1).approve(stakingManager.address, ethers.constants.MaxUint256)
            await lpt.connect(thirdParty).approve(stakingManager.address, ethers.constants.MaxUint256)
        })

        describe("Controller", () => {
            describe("setUnstakingPeriod", () => {
                it("should fail if caller is not Controller owner", async () => {
                    const tx = stakingManager.connect(notControllerOwner).setUnstakingPeriod(5)

                    await expect(tx).to.be.revertedWith("caller must be Controller owner")
                })

                it("should set unstakingPeriod", async () => {
                    const tx = stakingManager.connect(controllerOwner).setUnstakingPeriod(5)

                    await expect(tx).to.emit(stakingManager, "ParameterUpdate").withArgs("unstakingPeriod")
                    expect(await stakingManager.unstakingPeriod()).to.equal(5, "wrong unstakingPeriod")
                })
            })

            describe("setNumActiveTranscoders", () => {
                it("should fail if caller is not Controller owner", async () => {
                    const tx = stakingManager.connect(notControllerOwner).setNumActiveOrchestrators(7)

                    await expect(tx).to.be.revertedWith("caller must be Controller owner")
                })

                it("should set numActiveTranscoders", async () => {
                    const tx = stakingManager.connect(controllerOwner).setNumActiveOrchestrators(4)

                    await expect(tx).to.emit(stakingManager, "ParameterUpdate").withArgs("numActiveOrchestrators")
                    expect(await stakingManager.getOrchestratorPoolMaxSize()).to.equal(4, "wrong numActiveTranscoders")
                })
            })
        })

        describe("Orchestrator", () => {
            before(async () => {
                await fixture?.roundsManager?.setMockBool(functionSig("currentRoundInitialized()"), true)
                await fixture?.roundsManager?.setMockBool(functionSig("currentRoundLocked()"), false)
                await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound - 1)

                await stakingManager.connect(orchestrator0).stake(stakeAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                await stakingManager.connect(orchestrator0).orchestrator(5, 10, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                await stakingManager.connect(orchestrator1).stake(stakeAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                await stakingManager.connect(orchestrator1).orchestrator(5, 10, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound)
                await fixture?.roundsManager?.execute(stakingManager.address, functionSig("setCurrentRoundTotalActiveStake()"))
            })

            describe("orchestrator data", async () => {
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

                it("should get total stake for the round", async () => {
                    const stake0 = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                    const stake1 = await stakingManager.orchestratorTotalStake(orchestrator1.address)
                    const total = stake0.add(stake1)

                    const roundTotalStake = await stakingManager.getTotalStaked()

                    expect(roundTotalStake).to.equal(total)
                })
            })

            // Todo - when orchestrator pool is full

            describe("parameter updates", async () => {
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
                    await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + 1)
                    const tx = stakingManager.connect(orchestrator0).orchestrator(constants.PERC_DIVISOR_PRECISE.add(1), 10, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("REWARDSHARE_INVALID_PERC")
                })

                it("should fail if feeShare is not a valid percentage <= 100%", async () => {
                    await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + 1)
                    const tx = stakingManager.connect(orchestrator0).orchestrator(5, constants.PERC_DIVISOR_PRECISE.add(1), constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("FEESHARE_INVALID_PERC")
                })

                it("should fail if caller is not delegated to self with a non-zero bonded amount", async () => {
                    await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + 1)
                    const tx = stakingManager.connect(orchestrator2).orchestrator(5, 10, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("ORCHESTRATOR_NOT_REGISTERED")
                })

                it("should fail to changes its commission if active and not called reward", async () => {
                    const tx = stakingManager.connect(orchestrator0).orchestrator(6, 11, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    expect(tx).to.be.revertedWith("COMMISSION_RATES_LOCKED")
                })

                it("should make changes to its commission rates after calling reward", async () => {
                    await stakingManager.connect(orchestrator0).reward(constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    await stakingManager.connect(orchestrator0).orchestrator(6, 11, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    const oInfo = await stakingManager.getOrchestrator(orchestrator0.address)

                    expect(oInfo.rewardShare).to.equal(6)
                    expect(oInfo.feeShare).to.equal(11)
                })
            })

            describe("stake", async () => {
                it("should fail if current round is not initialized", async () => {
                    await fixture?.roundsManager?.setMockBool(functionSig("currentRoundInitialized()"), false)
                    const tx = stakingManager.connect(orchestrator0).stake(stakeAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("CURRENT_ROUND_NOT_INITIALIZED")
                })

                it("should increases stake for itself", async () => {
                    const currentStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                    await stakingManager.connect(orchestrator0).stake(stakeAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    const newStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)

                    expect(newStake).to.equal(currentStake.add(stakeAmount))
                })

                it("should fail if provided amount = 0", async () => {
                    const tx = stakingManager.connect(orchestrator0).stake(zeroAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("ZERO_DELEGATION_AMOUNT")
                })

                it("should fail if insufficient available balance", async () => {
                    const balance = await lpt.balanceOf(orchestrator0.address)
                    const tx = stakingManager.connect(orchestrator0).stake(balance.add(1000), constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("ERC20: transfer amount exceeds balance")
                })

                it("should fire a Stake event when staking", async () => {
                    const tx = await stakingManager.connect(orchestrator0).stake(stakeAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    expect(tx).to.emit(stakingManager, "Stake").withArgs(orchestrator0.address, stakeAmount)
                })

                it("should fail if orchestrator tries to delegate to itself", async () => {
                    const tx = stakingManager.connect(orchestrator0).delegate(stakeAmount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("CANNOT_SELF_DELEGATE")
                })
            })

            describe("unstake", async () => {
                it("should fail if provided amount = 0", async () => {
                    const tx = stakingManager.connect(orchestrator0).unstake(zeroAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("ZERO_UNSTAKE_AMOUNT")
                })

                it("should fail requested amount exceeds staked amount", async () => {
                    const excessAmount = stakeAmount + 1000
                    const tx = stakingManager.connect(orchestrator0).unstake(excessAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("AMOUNT_EXCEEDS_STAKE")
                })

                it("should unstake partially", async () => {
                    await stakingManager.connect(orchestrator0).reward(constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    const partialAmount = stakeAmount - 1000
                    const currentStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                    await stakingManager.connect(orchestrator0).unstake(partialAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    const newStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)

                    expect(newStake).to.equal(currentStake.sub(partialAmount))
                })

                it("should fire a Unstake event when unstaking", async () => {
                    const partialAmount = stakeAmount - 1000
                    const tx = stakingManager.connect(orchestrator0).unstake(partialAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.emit(stakingManager, "Unstake").withArgs(orchestrator0.address, partialAmount, 0)
                })

                it("should unstake fully", async () => {
                    const fullAmount = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                    const tx = stakingManager.connect(orchestrator0).unstake(fullAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx)
                        .to.emit(stakingManager, "OrchestratorDeactivated")
                        .withArgs(orchestrator0.address, currentRound + 1)
                })

                it("should fail if no stakes", async () => {
                    const fullAmount = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                    await stakingManager.connect(orchestrator0).unstake(fullAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    const tx = stakingManager.connect(orchestrator0).unstake(fullAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("CALLER_NOT_STAKED")
                })
            })

            describe("restake", async () => {
                let unstakingLockID: BigNumberish
                const unstakeAmount = stakeAmount / 2

                beforeEach(async () => {
                    await stakingManager.connect(orchestrator0).stake(stakeAmount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
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
                    const prevStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                    await stakingManager.connect(orchestrator0).restake(unstakingLockID, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    const newStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)

                    expect(prevStake).to.gte(ethers.BigNumber.from(unstakeAmount).sub(1))
                    expect(newStake).to.gte(ethers.BigNumber.from(stakeAmount).sub(1))
                })
            })

            describe("withdraw", async () => {
                describe("withdraw stake", async () => {
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

                        await expect(tx).to.be.revertedWith("system is paused")
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

                        await expect(tx).revertedWith("withdraw round must be before or equal to the current round")
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

                describe("withdraw fees", async () => {
                    // TODO
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

                it("should fail if provided amount = 0", async () => {
                    const tx = stakingManager.connect(delegator0).delegate(zeroAmount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("ZERO_DELEGATION_AMOUNT")
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
            })

            describe("changeDelegation", () => {
                const changeAmount = 4000

                beforeEach(async () => {
                    await stakingManager.connect(delegator0).delegate(stakeAmount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
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

                    await expect(tx).to.be.revertedWith("system is paused")
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

                    await expect(tx).revertedWith("withdraw round must be before or equal to the current round")
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
    })
})
