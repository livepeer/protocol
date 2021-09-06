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
        let delegator0: SignerWithAddress
        let delegator1: SignerWithAddress
        let thirdParty: SignerWithAddress
        const currentRound = 100

        before(async () => {
            orchestrator0 = signers[1]
            orchestrator1 = signers[2]
            delegator0 = signers[3]
            delegator1 = signers[4]
            thirdParty = signers[5]

            await lpt.mint(orchestrator0.address, 1000000)
            await lpt.mint(orchestrator1.address, 1000000)
            await lpt.mint(delegator0.address, 1000000)
            await lpt.mint(delegator1.address, 1000000)
            await lpt.mint(thirdParty.address, 1000000)

            await lpt.connect(orchestrator0).approve(stakingManager.address, ethers.constants.MaxUint256)
            await lpt.connect(orchestrator1).approve(stakingManager.address, ethers.constants.MaxUint256)
            await lpt.connect(delegator0).approve(stakingManager.address, ethers.constants.MaxUint256)
            await lpt.connect(delegator1).approve(stakingManager.address, ethers.constants.MaxUint256)
            await lpt.connect(thirdParty).approve(stakingManager.address, ethers.constants.MaxUint256)
        })

        it("should fail if current round is not initialized", async () => {
            await fixture?.roundsManager?.setMockBool(functionSig("currentRoundInitialized()"), false)

            await expect(stakingManager.connect(delegator0).delegate(1000, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)).to.be.revertedWith("CURRENT_ROUND_NOT_INITIALIZED")
        })

        describe("orchestrator", () => {
            before(async () => {
                await fixture?.roundsManager?.setMockBool(functionSig("currentRoundInitialized()"), true)
                await fixture?.roundsManager?.setMockBool(functionSig("currentRoundLocked()"), false)
                await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound - 1)

                await stakingManager.connect(orchestrator0).stake(1000, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                await stakingManager.connect(orchestrator0).orchestrator(5, 10, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                await stakingManager.connect(orchestrator1).stake(1000, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                await stakingManager.connect(orchestrator1).orchestrator(5, 10, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound)
            })

            describe("stake", async () => {
                it("should increases stake for itself", async () => {
                    const amount = 10000
                    const currentStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                    await stakingManager.connect(orchestrator0).stake(amount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    const newStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)

                    expect(newStake).to.equal(currentStake.add(amount))
                })

                it("should fail if provided amount = 0", async () => {
                    const amount = 0
                    const tx = stakingManager.connect(orchestrator0).stake(amount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("ZERO_DELEGATION_AMOUNT")
                })

                it("should fail if insufficient available balance", async () => {
                    const amount = 1200000
                    const tx = stakingManager.connect(orchestrator0).stake(amount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("ERC20: transfer amount exceeds balance")
                })

                it("should fire a Stake event when staking", async () => {
                    const amount = 10000
                    const tx = await stakingManager.connect(orchestrator0).stake(amount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    expect(tx).to.emit(stakingManager, "Stake").withArgs(orchestrator0.address, amount)
                })

                it("should fail if orchestrator tries to delegate to itself", async () => {
                    const amount = 10000
                    const tx = stakingManager.connect(orchestrator0).delegate(amount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("CANNOT_SELF_DELEGATE")
                })
            })

            describe("unstake", async () => {
                it("should fail if provided amount = 0", async () => {
                    const amount = 0
                    const tx = stakingManager.connect(orchestrator0).unstake(amount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("ZERO_UNSTAKE_AMOUNT")
                })

                it("should fail requested amount exceeds staked amount", async () => {
                    const amount = 20000
                    const tx = stakingManager.connect(orchestrator0).unstake(amount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("AMOUNT_EXCEEDS_STAKE")
                })

                it("should unstake partially", async () => {
                    await stakingManager.connect(orchestrator0).reward(constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    const amount = 1000
                    const currentStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                    await stakingManager.connect(orchestrator0).unstake(amount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    const newStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)

                    expect(newStake).to.equal(currentStake.sub(amount))
                })

                it("should fire a Unstake event when unstaking", async () => {
                    const amount = 1000
                    const tx = stakingManager.connect(orchestrator0).unstake(amount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.emit(stakingManager, "Unstake").withArgs(orchestrator0.address, amount, 0)
                })

                it("should unstake fully", async () => {
                    const amount = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                    const tx = stakingManager.connect(orchestrator0).unstake(amount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx)
                        .to.emit(stakingManager, "OrchestratorDeactivated")
                        .withArgs(orchestrator0.address, currentRound + 1)
                })

                it("should fail if no stakes", async () => {
                    const amount = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                    await stakingManager.connect(orchestrator0).unstake(amount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    const tx = stakingManager.connect(orchestrator0).unstake(amount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    await expect(tx).to.be.revertedWith("CALLER_NOT_STAKED")
                })
            })

            describe("restake", async () => {
                let unstakingLockID: BigNumberish
                const amount = 10000

                beforeEach(async () => {
                    await stakingManager.connect(orchestrator0).stake(amount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    const tx = await stakingManager.connect(orchestrator0).unstake(amount / 2, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    const events = await stakingManager.queryFilter(stakingManager.filters.Unstake(), tx.blockHash)
                    unstakingLockID = events[0].args.lockID
                })

                it("should fail for invalid unstakingLockID", async () => {
                    const unstakingLockID = 1234

                    const tx = stakingManager.connect(orchestrator0).restake(unstakingLockID, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    await expect(tx).to.be.revertedWith("INVALID_UNSTAKING_LOCK_ID")
                })

                it("should restake amount to itselfs", async () => {
                    const prevStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                    await stakingManager.connect(orchestrator0).restake(unstakingLockID, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    const newStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)

                    expect(prevStake).to.gte(ethers.BigNumber.from(amount / 2).sub(1))
                    expect(newStake).to.gte(ethers.BigNumber.from(amount).sub(1))
                })
            })

            describe("withdrawStake", async () => {
                it("should withdraws stake", async () => {})

                it("should fire a WithdrawStake event when withdrawing stake", async () => {})

                it("should withdraws fees", async () => {})

                it("should fire a WithdrawFees event when withdrawing fees", async () => {})
            })

            describe("third party", async () => {
                it("stakeFor", async () => {
                    const amount = 10000
                    const currentStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                    await stakingManager.connect(thirdParty).stakeFor(amount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    const newStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)

                    expect(newStake).to.equal(currentStake.add(amount))
                })

                it("should fail to call delegateFor to orchestrator on behalf of same orchestrator", async () => {
                    const amount = 10000
                    const tx = stakingManager.connect(thirdParty).delegateFor(amount, orchestrator0.address, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("CANNOT_SELF_DELEGATE")
                })
            })

            describe("accounting", async () => {
                it("should fail to changes its commission rates before calling reward", async () => {
                    const tx = stakingManager.connect(orchestrator0).orchestrator(6, 11, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    expect(tx).to.be.revertedWith("COMMISSION_RATES_LOCKED")
                })

                it("call reward", async () => {})

                it("should make changes its commission rates", async () => {})
            })
        })

        describe("delegator", () => {
            describe("delegate", () => {
                it("should fail if provided amount = 0", async () => {
                    const amount = 0
                    const tx = stakingManager.connect(delegator0).delegate(amount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("ZERO_DELEGATION_AMOUNT")
                })

                it("should fail if delegating to self", async () => {
                    const amount = 10000
                    const tx = stakingManager.connect(delegator0).delegate(amount, delegator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("CANNOT_SELF_DELEGATE")
                })

                it("should delegate towards an orchestrator", async () => {
                    const amount = 10000

                    const currentStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                    await stakingManager.connect(delegator0).delegate(amount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    const newStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)

                    expect(newStake).to.gte(currentStake.add(amount).sub(1))
                    expect(await stakingManager.getDelegatedStake(orchestrator0.address, delegator0.address)).to.be.gte(ethers.BigNumber.from(amount).sub(1))
                })

                it("should fire a Delegate event when delegating", async () => {
                    const amount = 10000
                    const tx = await stakingManager.connect(delegator0).delegate(amount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    expect(tx).to.emit(stakingManager, "Delegate").withArgs(delegator0.address, orchestrator0.address, amount)
                })
            })

            describe("changeDelegation", () => {
                beforeEach(async () => {
                    const amount = 10000
                    await stakingManager.connect(delegator0).delegate(amount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                })

                it("should fail if change delegation amount = 0", async () => {
                    const amount = 0

                    const tx = stakingManager.connect(delegator0).changeDelegation(amount, orchestrator0.address, orchestrator1.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    await expect(tx).to.be.revertedWith("ZERO_CHANGE_DELEGATION_AMOUNT")
                })

                it("should fail if delegator changes delegation for self", async () => {
                    const amount = 0

                    const tx = stakingManager.connect(delegator0).changeDelegation(amount, delegator0.address, orchestrator1.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    await expect(tx).to.be.revertedWith("CANNOT_CHANGE_DELEGATION_FOR_SELF")
                })

                it("should fail if orchestrator changes delegation for self", async () => {
                    const amount = 0

                    const tx = stakingManager.connect(orchestrator0).changeDelegation(amount, orchestrator0.address, orchestrator1.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    await expect(tx).to.be.revertedWith("CANNOT_CHANGE_DELEGATION_FOR_SELF")
                })

                it("should change delegation to another orchestrator", async () => {
                    const delta = 4000

                    const currentStake0 = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                    const currentStake1 = await stakingManager.orchestratorTotalStake(orchestrator1.address)

                    const delegatorShare0 = await stakingManager.getDelegatedStake(orchestrator0.address, delegator0.address)
                    const delegatorShare1 = await stakingManager.getDelegatedStake(orchestrator1.address, delegator0.address)

                    await stakingManager.connect(delegator0).changeDelegation(delta, orchestrator0.address, orchestrator1.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    const newStake0 = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                    const newStake1 = await stakingManager.orchestratorTotalStake(orchestrator1.address)

                    expect(newStake0).to.equal(currentStake0.sub(delta))
                    expect(newStake1).to.equal(currentStake1.add(delta))

                    expect(await stakingManager.getDelegatedStake(orchestrator0.address, delegator0.address)).to.be.gte(delegatorShare0.sub(delta).sub(1))
                    expect(await stakingManager.getDelegatedStake(orchestrator1.address, delegator0.address)).to.be.gte(delegatorShare1.add(delta).sub(1))
                })
            })

            describe("undelegate", () => {
                beforeEach(async () => {
                    const amount = 10000
                    await stakingManager.connect(delegator0).delegate(amount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                })

                it("should undelegate amount from an orchestrator", async () => {
                    const amount = 1000
                    const currentStake = await stakingManager.getDelegatedStake(orchestrator0.address, delegator0.address)
                    await stakingManager.connect(delegator0).undelegate(amount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    const newStake = await stakingManager.getDelegatedStake(orchestrator0.address, delegator0.address)

                    expect(newStake).to.gte(currentStake.sub(amount).sub(1))
                })

                it("should fire an Undelegate event when undelegating", async () => {
                    const amount = 1000
                    const tx = stakingManager.connect(delegator0).undelegate(amount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.emit(stakingManager, "Undelegate").withArgs(delegator0.address, orchestrator0.address, amount, 0)
                })
            })

            describe("redelegate", () => {
                let unstakingLockID: BigNumberish

                beforeEach(async () => {
                    const amount = 10000
                    await stakingManager.connect(delegator0).delegate(amount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    const tx = await stakingManager.connect(delegator0).undelegate(amount / 2, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    const events = await stakingManager.queryFilter(stakingManager.filters.Undelegate(), tx.blockHash)
                    unstakingLockID = events[0].args.lockID
                })

                it("should fail for invalid unstakingLockID", async () => {
                    const unstakingLockID = 1234

                    const tx = stakingManager.connect(delegator0).redelegate(unstakingLockID, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    await expect(tx).to.be.revertedWith("INVALID_UNSTAKING_LOCK_ID")
                })

                it("should redelegate amount to an orchestrator", async () => {
                    const amount = 10000

                    const prevStake = await stakingManager.getDelegatedStake(orchestrator0.address, delegator0.address)
                    await stakingManager.connect(delegator0).redelegate(unstakingLockID, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    const newStake = await stakingManager.getDelegatedStake(orchestrator0.address, delegator0.address)

                    expect(prevStake).to.gte(ethers.BigNumber.from(amount / 2).sub(1))
                    expect(newStake).to.gte(ethers.BigNumber.from(amount).sub(1))
                })
            })

            describe("withdraw", async () => {
                let unstakingLockID: BigNumberish
                const amount = 10000

                beforeEach(async () => {
                    await stakingManager.connect(delegator0).delegate(amount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    const tx = await stakingManager.connect(delegator0).undelegate(amount / 2, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    const events = await stakingManager.queryFilter(stakingManager.filters.Undelegate(), tx.blockHash)
                    unstakingLockID = events[0].args.lockID

                    await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound + UNSTAKING_PERIOD + 1)
                })

                it("should fail for invalid unstakingLockID", async () => {
                    const unstakingLockID = 1234

                    const tx = stakingManager.connect(delegator0).withdrawStake(unstakingLockID)
                    await expect(tx).to.be.revertedWith("INVALID_UNSTAKING_LOCK_ID")
                })

                it("should withdraw stake", async () => {
                    const prevBalance = await lpt.balanceOf(delegator0.address)
                    await stakingManager.connect(delegator0).withdrawStake(unstakingLockID)
                    const newBalance = await lpt.balanceOf(delegator0.address)

                    console.log(prevBalance.toString(), newBalance.toString())

                    expect(newBalance).to.gte(prevBalance.add(amount / 2).sub(1))
                })

                it("should fire a WithdrawStake event when withdrawing stake", async () => {
                    const tx = stakingManager.connect(delegator0).withdrawStake(unstakingLockID)

                    await expect(tx)
                        .to.emit(stakingManager, "WithdrawStake")
                        .withArgs(delegator0.address, unstakingLockID, amount / 2, currentRound + UNSTAKING_PERIOD)
                })
            })

            describe("third party", async () => {
                it("should delegate on behalf of delegator", async () => {
                    const amount = 10000

                    const currentStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                    await stakingManager.connect(thirdParty).delegateFor(amount, orchestrator0.address, delegator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    const newStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)

                    expect(newStake).to.equal(currentStake.add(amount))
                    expect(await stakingManager.getDelegatedStake(orchestrator0.address, delegator0.address)).to.be.gte(ethers.BigNumber.from(amount).sub(1))
                    expect(await stakingManager.getDelegatedStake(orchestrator0.address, thirdParty.address)).to.be.gte(ethers.BigNumber.from(0).sub(1))
                })
            })
        })
    })
})
