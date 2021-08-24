import Fixture from "./helpers/Fixture"
import {web3, ethers} from "hardhat"
import {BondingManager, BondingManager__factory, LivepeerToken, LivepeerToken__factory} from "../../typechain"
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/dist/src/signers"
import {functionSig} from "../../utils/helpers"
import chai from "chai"
import {solidity} from "ethereum-waffle"

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

        bondingManager = await fixture.deployAndRegister(
            bondingManagerFactory,
            "BondingManager",
            fixture?.controller?.address
        )

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
        let delegator: SignerWithAddress
        let delegator2: SignerWithAddress
        const currentRound = 100

        before(async () => {
            orchestrator0 = signers[0]
            delegator = signers[3]
            delegator2 = signers[4]

            await lpt.mint(orchestrator0.address, 1000000)
            await lpt.mint(delegator.address, 1000000)
            await lpt.mint(delegator2.address, 1000000)

            await lpt.connect(orchestrator0).approve(bondingManager.address, ethers.constants.MaxUint256)
            await lpt.connect(delegator).approve(bondingManager.address, ethers.constants.MaxUint256)
            await lpt.connect(delegator2).approve(bondingManager.address, ethers.constants.MaxUint256)
        })

        beforeEach(async () => {
            await fixture?.roundsManager?.setMockBool(functionSig("currentRoundInitialized()"), true)
            await fixture?.roundsManager?.setMockBool(functionSig("currentRoundLocked()"), false)
            await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound - 1)
            await bondingManager.connect(orchestrator0).bond(1000, orchestrator0.address)
            await bondingManager.connect(orchestrator0).transcoder(5, 10)
            await fixture?.roundsManager?.setMockUint256(functionSig("currentRound()"), currentRound)
        })

        it("should fail if current round is not initialized", async () => {
            await fixture?.roundsManager?.setMockBool(functionSig("currentRoundInitialized()"), false)

            await expect(bondingManager.connect(delegator).bond(1000, orchestrator0.address)).to.be.revertedWith(
                "current round is not initialized"
            )
        })

        describe("staking", () => {
            it("delegator stakes funds to orchestrator for itself", async () => {})

            it("delegator stakes funds to orchestrator on behalf of delegator 2", async () => {})
        })
    })
})
