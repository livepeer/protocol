import Fixture from "./helpers/Fixture"
import {web3, ethers} from "hardhat"
import {StakingManager, StakingManager__factory, LivepeerToken, LivepeerToken__factory} from "../../typechain"
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/dist/src/signers"
import {functionSig} from "../../utils/helpers"
import chai from "chai"
import {solidity} from "ethereum-waffle"
import {constants} from "../../utils/constants"
chai.use(solidity)
const {expect} = chai

describe("StakingManager", () => {
    let fixture: Fixture
    let stakingManager: StakingManager
    let lpt: LivepeerToken

    const UNSTAKING_PERIOD = 2
    const NUM_ACTIVE_ORCHESTRATORS = 2

    let signers: SignerWithAddress[]

    before(async () => {
        signers = await ethers.getSigners()
        fixture = new Fixture(web3)
        await fixture.deploy()

        const llFac = await ethers.getContractFactory("SortedDoublyLL")
        const ll = await llFac.deploy()

        const stakingManagerFactory = new StakingManager__factory(
            {
                "contracts/utils/SortedDoublyLL.sol:SortedDoublyLL": ll.address
            },
            signers[0]
        )

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

            describe("staking", async () => {
                it("should increases stake for itself", async () => {
                    const amount = 1000
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

                it("should fire a Stake event when staking", async () => {
                    const amount = 1000
                    const tx = await stakingManager.connect(orchestrator0).stake(amount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    expect(tx).to.emit(stakingManager, "Stake").withArgs(orchestrator0.address, amount)
                })

                it("should fail if orchestrator tries to delegate to itself", async () => {
                    const amount = 1000
                    const tx = stakingManager.connect(orchestrator0).delegate(amount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("CANNOT_SELF_DELEGATE")
                })
            })

            describe("unstaking", async () => {
                it("should fail if provided amount = 0", async () => {
                    const amount = 0
                    const tx = stakingManager.connect(orchestrator0).unstake(amount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("ZERO_UNSTAKE_AMOUNT")
                })

                it("should fail requested amount exceeds staked amount", async () => {
                    const amount = 2000
                    const tx = stakingManager.connect(orchestrator0).unstake(amount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("AMOUNT_EXCEEDS_STAKE")
                })

                it("should unstake partially", async () => {
                    // const amount = 100
                    // const currentStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                    // await stakingManager.connect(orchestrator0).unstake(amount, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    // const newStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                    // expect(newStake).to.equal(currentStake.sub(amount))
                })

                it("should fire a Unstake event when unstaking", async () => {})

                it("should unstake fully", async () => {})

                it("should fail if no stakes", async () => {})
            })

            describe("restaking", async () => {
                it("should restake", async () => {})
            })

            describe("withdraws", async () => {
                it("should withdraws stake", async () => {})

                it("should fire a WithdrawStake event when withdrawing stake", async () => {})

                it("should withdraws fees", async () => {})

                it("should fire a WithdrawFees event when withdrawing fees", async () => {})
            })

            describe("third party", async () => {
                it("stakes on behalf", async () => {
                    const amount = 1000
                    const currentStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                    await stakingManager.connect(thirdParty).stakeFor(amount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    const newStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)

                    expect(newStake).to.equal(currentStake.add(amount))
                })

                it("should fail to delegate to orchestrator on behalf of same orchestrator", async () => {
                    const amount = 1000
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
            describe("delegation", () => {
                it("should fail if provided amount = 0", async () => {
                    const amount = 0
                    const tx = stakingManager.connect(delegator0).delegate(amount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("ZERO_DELEGATION_AMOUNT")
                })

                it("should fail if delegating to self", async () => {
                    const amount = 1000
                    const tx = stakingManager.connect(delegator0).delegate(amount, delegator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    await expect(tx).to.be.revertedWith("CANNOT_SELF_DELEGATE")
                })

                it("should delegate towards an orchestrator", async () => {
                    const amount = 1000

                    const currentStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                    await stakingManager.connect(delegator0).delegate(amount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    const newStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)

                    expect(newStake).to.equal(currentStake.add(amount))
                    expect(await stakingManager.getDelegatedStake(orchestrator0.address, delegator0.address)).to.be.equal(ethers.BigNumber.from(amount))
                })

                it("should fire a Delegate event when delegating", async () => {
                    const amount = 1000
                    const tx = await stakingManager.connect(delegator0).delegate(amount, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    expect(tx).to.emit(stakingManager, "Delegate").withArgs(delegator0.address, orchestrator0.address, amount)
                })
            })

            describe("change delegation", () => {
                it("should change delegation to another orchestrator", async () => {})

                it("should fail if change delegation amount = 0", async () => {})
            })

            describe("undelegation", () => {
                it("should undelegate amount from an orchestrator", async () => {})

                it("should fire an Undelegate event when undelegating", async () => {})
            })

            describe("redelegation", () => {
                it("should redelegate amount to an orchestrator", async () => {})
            })

            describe("withdraws", async () => {
                it("should withdraws stake", async () => {})

                it("should fire a WithdrawStake event when withdrawing stake", async () => {})
            })

            describe("third party", async () => {
                it("should delegate on behalf of delegator", async () => {
                    const amount = 1000

                    const currentStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)
                    await stakingManager.connect(thirdParty).delegateFor(amount, orchestrator0.address, delegator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    const newStake = await stakingManager.orchestratorTotalStake(orchestrator0.address)

                    expect(newStake).to.equal(currentStake.add(amount))
                    expect(await stakingManager.getDelegatedStake(orchestrator0.address, delegator0.address)).to.be.equal(ethers.BigNumber.from(amount))
                    expect(await stakingManager.getDelegatedStake(orchestrator0.address, thirdParty.address)).to.be.equal(ethers.BigNumber.from(0))
                })
            })
        })
    })
})
