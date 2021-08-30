import Fixture from "./helpers/Fixture"
import {web3, ethers} from "hardhat"
import {BondingManager, BondingManager__factory, LivepeerToken, LivepeerToken__factory} from "../../typechain"
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/dist/src/signers"
import {functionSig} from "../../utils/helpers"
import chai from "chai"
import {solidity} from "ethereum-waffle"
import {constants} from "../../utils/constants"
chai.use(solidity)
const {expect} = chai

describe("BondingManager", () => {
    let fixture: Fixture
    let bondingManager: BondingManager
    let lpt: LivepeerToken

    const NUM_ACTIVE_TRANSCODERS = 2
    const UNBONDING_PERIOD = 2

    let signers: SignerWithAddress[]

    before(async () => {
        signers = await ethers.getSigners()
        fixture = new Fixture(web3)
        await fixture.deploy()

        const llFac = await ethers.getContractFactory("SortedDoublyLL")
        const ll = await llFac.deploy()

        const bondingManagerFactory = new BondingManager__factory(
            {
                "contracts/utils/SortedDoublyLL.sol:SortedDoublyLL": ll.address
            },
            signers[0]
        )

        bondingManager = await fixture.deployAndRegister(bondingManagerFactory, "BondingManager", fixture?.controller?.address)

        const lptFactory = new LivepeerToken__factory(signers[0])
        lpt = await fixture.deployAndRegister(lptFactory, "LivepeerToken")

        await bondingManager.setUnbondingPeriod(UNBONDING_PERIOD)
        await bondingManager.setNumActiveTranscoders(NUM_ACTIVE_TRANSCODERS)
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("bond", () => {
        let orchestrator0: SignerWithAddress
        let orchestrator1: SignerWithAddress
        let delegator0: SignerWithAddress
        let delegator1: SignerWithAddress
        const currentRound = 100

        before(async () => {
            orchestrator0 = signers[1]
            orchestrator1 = signers[2]
            delegator0 = signers[3]
            delegator1 = signers[4]

            await lpt.mint(orchestrator0.address, 1000000)
            await lpt.mint(orchestrator1.address, 1000000)
            await lpt.mint(delegator0.address, 1000000)
            await lpt.mint(delegator1.address, 1000000)

            await lpt.connect(orchestrator0).approve(bondingManager.address, ethers.constants.MaxUint256)
            await lpt.connect(orchestrator1).approve(bondingManager.address, ethers.constants.MaxUint256)
            await lpt.connect(delegator0).approve(bondingManager.address, ethers.constants.MaxUint256)
            await lpt.connect(delegator1).approve(bondingManager.address, ethers.constants.MaxUint256)
        })

        it("should fail if current round is not initialized", async () => {
            await fixture?.roundsManager?.setMockBool(functionSig("currentRoundInitialized()"), false)

            await expect(bondingManager.connect(delegator0).bond(1000, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS)).to.be.revertedWith("current round is not initialized")
        })

        describe("staking", () => {
            before(async () => {
                await fixture?.roundsManager?.setMockBool(functionSig("currentRoundInitialized()"), true)
                await fixture?.roundsManager?.setMockBool(functionSig("currentRoundLocked()"), false)
                await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound - 1)

                await bondingManager.connect(orchestrator0).bond(1000, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                await bondingManager.connect(orchestrator1).bond(1000, orchestrator1.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                await bondingManager.connect(orchestrator0).transcoder(5, 10)
                await bondingManager.connect(orchestrator1).transcoder(5, 10)

                await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound)
            })

            describe("caller is unbonded", () => {
                it("should fail if orchestrator delegates to another orchestrator", async () => {
                    await expect(bondingManager.connect(orchestrator0).bond(1000, orchestrator1.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS)).to.be.revertedWith("ORCHESTRATOR_CAN_NOT_DELEGATE")
                })

                it("should fail if provided amount = 0", async () => {
                    await expect(bondingManager.connect(delegator0).bond(ethers.BigNumber.from(0), orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS)).to.be.revertedWith(
                        "ZERO_DELEGATION_AMOUNT"
                    )
                })

                it("delegator stakes funds to orchestrator for itself", async () => {
                    const startDelegatedAmount = await bondingManager.orchestratorTotalStake(orchestrator0.address)
                    await bondingManager.connect(delegator0).bond(1000, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    expect(await bondingManager.orchestratorTotalStake(orchestrator0.address)).to.equal(startDelegatedAmount.add(1000), "wrong change in delegatedAmount")
                    expect(await bondingManager.stakeOf(orchestrator0.address, delegator0.address)).to.equal(ethers.BigNumber.from(1000), "wrong bondedAmount")
                })

                it("should fire a Bond event when bonding", async () => {
                    const txRes = await bondingManager.connect(delegator0).bond(1000, orchestrator0.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS)
                    expect(txRes).to.emit(bondingManager, "Bond").withArgs(orchestrator0.address, delegator0.address, 1000, 1000)
                })

                it("delegator stakes funds to orchestrator on behalf of second delegator", async () => {
                    const startDelegatedAmount = await bondingManager.orchestratorTotalStake(orchestrator0.address)
                    await bondingManager.connect(delegator0).bondFor(1000, orchestrator0.address, delegator1.address, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS, constants.NULL_ADDRESS)

                    expect(await bondingManager.orchestratorTotalStake(orchestrator0.address)).to.equal(startDelegatedAmount.add(1000), "wrong change in delegatedAmount")
                    expect(await bondingManager.stakeOf(orchestrator0.address, delegator0.address)).to.equal(ethers.BigNumber.from(0), "wrong bondedAmount for proxy delegator")
                    expect(await bondingManager.stakeOf(orchestrator0.address, delegator1.address)).to.equal(ethers.BigNumber.from(1000), "wrong bondedAmount for stake owner")
                })
            })
        })
    })
})
