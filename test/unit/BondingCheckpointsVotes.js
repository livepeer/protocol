import Fixture from "./helpers/Fixture"
import {functionSig} from "../../utils/helpers"
import {assert} from "chai"
import {ethers, web3} from "hardhat"
import chai from "chai"
import {solidity} from "ethereum-waffle"
import {BigNumber} from "ethers"

chai.use(solidity)
const {expect} = chai

describe("BondingCheckpointsVotes", () => {
    let signers
    let fixture

    let bondingCheckpointsVotes

    before(async () => {
        signers = await ethers.getSigners()

        fixture = new Fixture(web3)
        await fixture.deploy()

        const bondingCheckpointsVotesFac = await ethers.getContractFactory(
            "BondingCheckpointsVotes"
        )

        bondingCheckpointsVotes = await fixture.deployAndRegister(
            bondingCheckpointsVotesFac,
            "BondingCheckpointsVotes",
            fixture.controller.address
        )
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("IERC6372Upgradeable", () => {
        describe("clock", () => {
            it("should proxy to BondingCheckpoints", async () => {
                await fixture.bondingCheckpoints.setMockUint256(
                    functionSig("clock()"),
                    12348
                )
                assert.equal(await bondingCheckpointsVotes.clock(), 12348)
            })
        })

        describe("CLOCK_MODE", () => {
            it("should proxy to BondingCheckpoints", async () => {
                assert.equal(
                    await bondingCheckpointsVotes.CLOCK_MODE(),
                    // BondingCheckpointsMock returns this
                    "mode=cuckoo&species=dasylophus_superciliosus"
                )
            })
        })
    })

    // Same implementation as the BondingCheckpointsMock
    const mockGetBondingStateAt = (_account, _round) => {
        const intAddr = BigNumber.from(_account)

        // lowest 4 bytes of address + _round
        const amount = intAddr.mask(32).add(_round)
        // (_account << 4) | _round
        const delegateAddress = intAddr.shl(4).mask(160).or(_round)

        return [
            amount.toNumber(),
            ethers.utils.getAddress(delegateAddress.toHexString())
        ]
    }

    describe("get(Past)?Votes", () => {
        it("getPastVotes should proxy to BondingCheckpoints.getBondingStateAt", async () => {
            const testOnce = async (account, round) => {
                const [expected] = mockGetBondingStateAt(account.address, round)

                const votes = await bondingCheckpointsVotes.getPastVotes(
                    account.address,
                    round
                )
                assert.equal(votes.toNumber(), expected)
            }

            await testOnce(signers[0], 123)
            await testOnce(signers[1], 256)
            await testOnce(signers[2], 34784)
        })

        it("getVotes should query with the current round", async () => {
            const testOnce = async (account, round) => {
                await fixture.bondingCheckpoints.setMockUint256(
                    functionSig("clock()"),
                    round
                )
                const [expected] = mockGetBondingStateAt(account.address, round)

                const votes = await bondingCheckpointsVotes.getVotes(
                    account.address
                )
                assert.equal(votes.toNumber(), expected)
            }

            await testOnce(signers[3], 321)
            await testOnce(signers[4], 652)
            await testOnce(signers[5], 48743)
        })
    })

    describe("delegate(s|dAt)", () => {
        it("delegatedAt should proxy to BondingCheckpoints.getBondingStateAt", async () => {
            const testOnce = async (account, round) => {
                const [, expected] = mockGetBondingStateAt(
                    account.address,
                    round
                )

                const delegate = await bondingCheckpointsVotes.delegatedAt(
                    account.address,
                    round
                )
                assert.equal(delegate, expected)
            }

            await testOnce(signers[6], 123)
            await testOnce(signers[7], 256)
            await testOnce(signers[8], 34784)
        })

        it("delegates should query with the current round", async () => {
            const testOnce = async (account, round) => {
                await fixture.bondingCheckpoints.setMockUint256(
                    functionSig("clock()"),
                    round
                )
                const [, expected] = mockGetBondingStateAt(
                    account.address,
                    round
                )

                assert.equal(
                    await bondingCheckpointsVotes.delegates(account.address),
                    expected
                )
            }

            await testOnce(signers[9], 321)
            await testOnce(signers[10], 652)
            await testOnce(signers[11], 48743)
        })
    })

    describe("getPastTotalSupply", () => {
        it("should proxy to BondingCheckpoints.getTotalActiveStakeAt", async () => {
            const testOnce = async round => {
                const expected = 4 * round // same as BondingCheckpointsMock impl

                const totalSupply =
                    await bondingCheckpointsVotes.getPastTotalSupply(round)
                assert.equal(totalSupply.toNumber(), expected)
            }

            await testOnce(213)
            await testOnce(526)
            await testOnce(784347)
        })
    })

    describe("delegation", () => {
        it("should fail to call delegate", async () => {
            await expect(
                bondingCheckpointsVotes
                    .connect(signers[0])
                    .delegate(signers[1].address)
            ).to.be.revertedWith("MustCallBondingManager()")
        })

        it("should fail to call delegateBySig", async () => {
            await expect(
                bondingCheckpointsVotes.delegateBySig(
                    signers[1].address,
                    420,
                    1689794400,
                    171,
                    ethers.utils.hexZeroPad("0xfacade", 32),
                    ethers.utils.hexZeroPad("0xdeadbeef", 32)
                )
            ).to.be.revertedWith("MustCallBondingManager()")
        })
    })
})
