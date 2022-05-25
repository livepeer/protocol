import Fixture from "./helpers/Fixture"
import {web3, ethers} from "hardhat"

import {expect, use} from "chai"
import {solidity} from "ethereum-waffle"
import {smock} from "@defi-wonderland/smock"

use(solidity)
use(smock.matchers)

const QUORUM = 333300
const QUOTA = 500000
const POLL_PERIOD = 10 * 5760

describe("PollCreator", () => {
    let fixture
    let pollCreator

    let bondingManagerMock
    let mockBondingManagerEOA

    before(async () => {
        ;[, mockBondingManagerEOA] = await ethers.getSigners()

        fixture = new Fixture(web3)

        bondingManagerMock = await smock.fake(
            "contracts/polling/PollCreator.sol:IBondingManager",
            {
                address: mockBondingManagerEOA.address
            }
        )
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("constructor", () => {
        before(async () => {
            pollCreator = await (
                await ethers.getContractFactory("PollCreator")
            ).deploy(bondingManagerMock.address)
        })

        it("initialize state: bondingManager", async () => {
            expect(await pollCreator.bondingManager()).to.be.equal(
                bondingManagerMock.address
            )
        })
    })

    describe("createPoll", () => {
        const hash = "0x1230000000000000000000000000000000000000"

        before(async () => {
            pollCreator = await (
                await ethers.getContractFactory("PollCreator")
            ).deploy(bondingManagerMock.address)
        })

        it("revert when caller has insufficient stake", async () => {
            const cost = await pollCreator.POLL_CREATION_COST()

            // pendingStake() == 0 && transcoderTotalStake() == 0
            await expect(pollCreator.createPoll(hash)).to.be.revertedWith(
                "PollCreator#createPoll: INSUFFICIENT_STAKE"
            )

            // pendingStake() > 0 && transcoderTotalStake() == 0
            bondingManagerMock.pendingStake.returns(cost.sub(1))
            await expect(pollCreator.createPoll(hash)).to.be.revertedWith(
                "PollCreator#createPoll: INSUFFICIENT_STAKE"
            )

            // pendingStake() == 0 && transcoderTotalStake() > 0
            bondingManagerMock.pendingStake.returns(0)
            bondingManagerMock.transcoderTotalStake.returns(cost.sub(1))
            await expect(pollCreator.createPoll(hash)).to.be.revertedWith(
                "PollCreator#createPoll: INSUFFICIENT_STAKE"
            )

            // pendingStake() > 0 && transcoderTotalStake() > 0
            bondingManagerMock.pendingStake.returns(cost.sub(1))
            await expect(pollCreator.createPoll(hash)).to.be.revertedWith(
                "PollCreator#createPoll: INSUFFICIENT_STAKE"
            )
        })

        it("creates a poll", async () => {
            const cost = await pollCreator.POLL_CREATION_COST()

            // pendingStake() > POLL_CREATION_COST
            bondingManagerMock.pendingStake.returns(cost.add(1))

            const start = await fixture.rpc.getBlockNumberAsync()
            const end = start + POLL_PERIOD + 1 // + 1 because createPoll tx will mine a new block

            let tx = await pollCreator.createPoll(hash)
            let receipt = await tx.wait()
            await expect(tx)
                .to.emit(pollCreator, "PollCreated")
                .withArgs(receipt.events[0].args[0], hash, end, QUORUM, QUOTA)

            // pendingStake() == POLL_CREATION_COST
            bondingManagerMock.pendingStake.returns(cost)

            tx = await pollCreator.createPoll(hash)
            receipt = await tx.wait()
            await expect(tx)
                .to.emit(pollCreator, "PollCreated")
                .withArgs(
                    receipt.events[0].args[0],
                    hash,
                    end + 1,
                    QUORUM,
                    QUOTA
                )

            // transcoderTotalStake() > POLL_CREATION_COST
            bondingManagerMock.pendingStake.returns(0)
            bondingManagerMock.transcoderTotalStake.returns(cost.add(1))

            tx = await pollCreator.createPoll(hash)
            receipt = await tx.wait()
            await expect(tx)
                .to.emit(pollCreator, "PollCreated")
                .withArgs(
                    receipt.events[0].args[0],
                    hash,
                    end + 2,
                    QUORUM,
                    QUOTA
                )

            // transcoderTotalStake() == POLL_CREATION_COST
            bondingManagerMock.transcoderTotalStake.returns(cost)

            tx = await pollCreator.createPoll(hash)
            receipt = await tx.wait()
            await expect(tx)
                .to.emit(pollCreator, "PollCreated")
                .withArgs(
                    receipt.events[0].args[0],
                    hash,
                    end + 3,
                    QUORUM,
                    QUOTA
                )
        })
    })
})
