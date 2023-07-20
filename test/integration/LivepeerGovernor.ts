import {ethers} from "hardhat"
import {SignerWithAddress as Signer} from "@nomiclabs/hardhat-ethers/dist/src/signers"
import {BigNumberish} from "ethers"
import chai, {assert, expect} from "chai"
import {solidity} from "ethereum-waffle"

import {contractId} from "../../utils/helpers"
import setupIntegrationTest from "../helpers/setupIntegrationTest"
import {
    AdjustableRoundsManager,
    BondingCheckpointsVotes,
    BondingManager,
    Controller,
    LivepeerGovernor,
    LivepeerToken,
    PollCreator,
    Treasury
} from "../../typechain"
import {ProposalState, VoteType} from "../helpers/governorEnums"
import RPC from "../../utils/rpc"
import {constants} from "../../utils/constants"

chai.use(solidity)

describe("LivepeerGovernor", () => {
    let rpc: RPC
    let controller: Controller

    let roundsManager: AdjustableRoundsManager
    let bondingManager: BondingManager
    let bondingCheckpointsVotes: BondingCheckpointsVotes
    let token: LivepeerToken
    let pollCreator: PollCreator

    let treasury: Treasury
    let governor: LivepeerGovernor

    let signers: Signer[]
    let proposer: Signer // the only participant here
    let roundLength: number

    before(async () => {
        rpc = new RPC((global as any).web3)
        signers = await ethers.getSigners()
        proposer = signers[0]

        const fixture = await setupIntegrationTest({
            tags: ["LivepeerGovernor"]
        })
        controller = await ethers.getContractAt(
            "Controller",
            fixture.Controller.address
        )
        roundsManager = await ethers.getContractAt(
            "AdjustableRoundsManager",
            fixture.AdjustableRoundsManager.address
        )
        roundLength = (await roundsManager.roundLength()).toNumber()
        bondingManager = await ethers.getContractAt(
            "BondingManager",
            fixture.BondingManager.address
        )
        bondingCheckpointsVotes = await ethers.getContractAt(
            "BondingCheckpointsVotes",
            fixture.BondingCheckpointsVotes.address
        )
        token = await ethers.getContractAt(
            "LivepeerToken",
            fixture.LivepeerToken.address
        )
        pollCreator = await ethers.getContractAt(
            "PollCreator",
            fixture.PollCreator.address
        )

        treasury = await ethers.getContractAt(
            "Treasury",
            fixture.Treasury.address
        )
        governor = await ethers.getContractAt(
            "LivepeerGovernor",
            fixture.LivepeerGovernor.address
        )

        await controller.unpause()

        await bond(proposer, ethers.utils.parseEther("100"), proposer)

        // the bond checkpoints on the next round, and Governor.propose()
        // checks the previous round, so we need to wait 2 rounds here
        await waitRounds(2)
    })

    let snapshotId: string

    beforeEach(async () => {
        snapshotId = await rpc.snapshot()
    })

    afterEach(async () => {
        await rpc.revert(snapshotId)
    })

    it("ensure deployment success", async () => {
        assert.equal(await governor.name(), "LivepeerGovernor")
    })

    async function bond(
        delegator: Signer,
        amount: BigNumberish,
        transcoder: Signer
    ) {
        await token.transfer(delegator.address, amount)
        await token.connect(delegator).approve(bondingManager.address, amount)
        await bondingManager.connect(delegator).bond(amount, transcoder.address)
    }

    async function waitRounds(rounds: number) {
        for (let i = 0; i < rounds; i++) {
            await roundsManager.mineBlocks(roundLength)
            await roundsManager.initializeRound()
        }
    }

    async function governorExecute(
        signer: Signer,
        target: string,
        functionData: string,
        description: string
    ) {
        const tx = await governor
            .connect(signer)
            .propose([target], [0], [functionData], description)
        const filter = governor.filters.ProposalCreated()
        const events = await governor.queryFilter(
            filter,
            tx.blockNumber,
            tx.blockNumber
        )
        const proposalId = events[0].args[0]

        // let the voting begin
        await waitRounds(2)

        await governor.connect(signer).castVote(proposalId, VoteType.For)

        await waitRounds(10)

        const descriptionHash = ethers.utils.solidityKeccak256(
            ["string"],
            [description]
        )
        await governor
            .connect(signer)
            .queue([target], [0], [functionData], descriptionHash)
        await governor
            .connect(signer)
            .execute([target], [0], [functionData], descriptionHash)

        assert.equal(await governor.state(proposalId), ProposalState.Executed)
    }

    describe("treasury timelock", async () => {
        it("should have 0 initial minDelay", async () => {
            const minDelay = await treasury.getMinDelay()
            assert.equal(minDelay.toNumber(), 0)
        })

        describe("should allow updating minDelay", () => {
            const testDelay = 3 * 24 * 60 * 60 // 3 days

            beforeEach(async () => {
                await governorExecute(
                    signers[0],
                    treasury.address,
                    treasury.interface.encodeFunctionData("updateDelay", [
                        testDelay
                    ]),
                    "set treasury minDelay to 3 days"
                )
            })

            it("should return new value", async () => {
                const minDelay = await treasury.getMinDelay()
                assert.equal(minDelay.toNumber(), testDelay)
            })

            it("should effectively delay execution", async () => {
                // default execute code will not wait for the 3 days after queueing
                const tx = governorExecute(
                    signers[0],
                    token.address,
                    token.interface.encodeFunctionData("transfer", [
                        signers[1].address,
                        ethers.utils.parseEther("500")
                    ]),
                    "sample transfer"
                )

                await expect(tx).to.be.revertedWith(
                    "TimelockController: operation is not ready"
                )
            })
        })
    })

    describe("settings", () => {
        const testProperty = (
            name: string,
            initialValue: BigNumberish,
            setFunc?: string,
            newValue?: BigNumberish
        ) => {
            describe(name, () => {
                let getter: typeof governor["votingDelay"]

                before(async () => {
                    getter = governor[
                        name as keyof LivepeerGovernor
                    ] as typeof getter
                })

                it(`should start as ${initialValue}`, async () => {
                    const value = await getter()
                    assert.equal(value.toString(), initialValue.toString())
                })

                if (setFunc && newValue) {
                    it("should be updatable", async () => {
                        await governorExecute(
                            proposer,
                            governor.address,
                            governor.interface.encodeFunctionData(
                                setFunc as any,
                                [newValue]
                            ),
                            `set ${name} to ${newValue}`
                        )

                        const value = await getter()
                        assert.equal(value.toString(), newValue.toString())
                    })
                }
            })
        }

        testProperty("votingDelay", 1, "setVotingDelay", 5)
        testProperty("votingPeriod", 10, "setVotingPeriod", 14)
        testProperty(
            "proposalThreshold",
            ethers.utils.parseEther("100"),
            "setProposalThreshold",
            ethers.utils.parseEther("50")
        )
        testProperty(
            "quorumNumerator()",
            333300, // 33.33%
            "updateQuorumNumerator",
            500000 // 50%
        )
        testProperty("quorumDenominator", constants.PERC_DIVISOR)
    })

    describe("voting module", () => {
        it("should use BondingCheckpointVotes as the token", async () => {
            const tokenAddr = await governor.token()
            assert.equal(tokenAddr, bondingCheckpointsVotes.address)
        })

        describe("bumpVotesAddress()", () => {
            let newBondingCheckpointsVotes: BondingCheckpointsVotes

            before(async () => {
                const factory = await ethers.getContractFactory(
                    "BondingCheckpoints"
                )
                newBondingCheckpointsVotes = (await factory.deploy(
                    controller.address
                )) as BondingCheckpointsVotes

                const id = contractId("BondingCheckpointsVotes")
                const [, gitCommitHash] = await controller.getContractInfo(id)
                await controller.setContractInfo(
                    id,
                    newBondingCheckpointsVotes.address,
                    gitCommitHash
                )
            })

            it("should not update the reference automatically", async () => {
                assert.equal(
                    await governor.token(),
                    bondingCheckpointsVotes.address
                )
            })

            it("should update reference after calling bumpVotesAddress", async () => {
                await governor.bumpVotesAddress()
                assert.equal(
                    await governor.token(),
                    newBondingCheckpointsVotes.address
                )
            })
        })

        describe("quota()", () => {
            it("should return the same value as PollCreator", async () => {
                const expected = await pollCreator
                    .QUOTA()
                    .then(bn => bn.toString())
                const actual = await governor.quota().then(bn => bn.toString())
                assert.equal(actual, expected)
            })
        })
    })
})
