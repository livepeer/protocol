import Fixture from "./helpers/Fixture"

import truffleAssert from "truffle-assertions"
import {utils, BigNumber, constants} from "ethers"
import {BN} from "ethereumjs-util"

const Governor = artifacts.require("Governor")
const SetUint256 = artifacts.require("SetUint256")

contract("Governor", accounts => {
    let fixture
    let governor
    let setUint256

    before(() => {
        fixture = new Fixture(web3)
    })

    beforeEach(async () => {
        await fixture.setUp()
        governor = await Governor.new()
        setUint256 = await SetUint256.new()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })


    const setUint256Tx = async (i, sender) => {
        return utils.hexlify(utils.arrayify(setUint256.contract.methods.setUint256(BigNumber.from(i)).encodeABI()))
    }

    const getUpdateHash = update => {
        return utils.keccak256(utils.defaultAbiCoder.encode(["tuple(address[] target, uint[] value, bytes[] data, uint256 nonce)"], [update]))
    }

    describe("constructor", () => {
        it("initializes state: owner", async () => {
            assert.equal(await governor.owner(), accounts[0])
        })
    })

    describe("transferOwnership", () => {
        it("reverts if not called by the contract itself, even if msg.sender is the owner", async () => {
            await truffleAssert.reverts(
                governor.transferOwnership(accounts[1]),
                "unauthorized: msg.sender not Governor"
            )
        })

        it("reverts if the new owner address is the zero-value for the address type", async () => {
            const txData = utils.arrayify(governor.contract.methods.transferOwnership(constants.AddressZero).encodeABI())
            await governor.stage(
                {
                    target: [governor.address],
                    value: ["0"],
                    data: [txData],
                    nonce: 1
                },
                "0"
            )

            await truffleAssert.reverts(
                governor.execute(
                    {
                        target: [governor.address],
                        value: ["0"],
                        data: [txData],
                        nonce: 1
                    }
                ),
                "newOwner is a null address"
            )
        })

        it("updates ownership to a new owner", async () => {
            const txData = utils.arrayify(governor.contract.methods.transferOwnership(accounts[1]).encodeABI())
            await governor.stage(
                {
                    target: [governor.address],
                    value: ["0"],
                    data: [txData],
                    nonce: 1
                },
                "0"
            )

            const tx = await governor.execute(
                {
                    target: [governor.address],
                    value: ["0"],
                    data: [txData],
                    nonce: 1
                }
            )

            assert.equal(await governor.owner(), accounts[1])
            truffleAssert.eventEmitted(tx, "OwnershipTransferred", e => e.previousOwner == accounts[0] && e.newOwner == accounts[1])
        })
    })

    describe("stageUpdate", () => {
        it("reverts when sender is not owner", async () => {
            const data = await setUint256Tx("0", accounts[0])

            await truffleAssert.reverts(
                governor.stage(
                    {
                        target: [setUint256.address],
                        value: ["0"],
                        data: [data],
                        nonce: 1
                    },
                    "0",
                    {from: accounts[1]}
                ),
                "unauthorized: msg.sender not owner",
            )
        })

        it("reverts when an update is already staged", async () => {
            // stage an update
            const data = await setUint256Tx("1", accounts[0])

            await governor.stage(
                {
                    target: [setUint256.address],
                    value: ["0"],
                    data: [data],
                    nonce: 1
                },
                "5"
            )

            // try staging the same update (same hash)
            await truffleAssert.reverts(
                governor.stage(
                    {
                        target: [setUint256.address],
                        value: ["0"],
                        data: [data],
                        nonce: 1
                    },
                    "5"
                ),
                "update already staged"
            )
        })

        it("reverts when the current block number added by the delay overflows", async () => {
            const data = await setUint256Tx("1", accounts[0])

            await fixture.rpc.mine()

            await truffleAssert.reverts(
                governor.stage(
                    {
                        target: [setUint256.address],
                        value: ["0"],
                        data: [data],
                        nonce: 1
                    },
                    constants.MaxUint256
                )
            )
        })

        it("stage emits an UpdateStaged event", async () => {
            const data = await setUint256Tx("1", accounts[0])
            const update = {
                target: [setUint256.address],
                value: ["0"],
                data: [data],
                nonce: 1
            }

            const updateHash = getUpdateHash(update)
            const blockNum = await fixture.rpc.getBlockNumberAsync()

            const tx = await governor.stage(
                update,
                "5"
            )

            assert.equal((await governor.updates(updateHash)).toNumber(), blockNum + 5 + 1) // + 1 because stage() mines a block

            truffleAssert.eventEmitted(
                tx,
                "UpdateStaged",
                e => e.update.target[0] == update.target[0]
                    && e.update.value[0] == update.value[0]
                    && e.update.data[0] == update.data[0]
                    && e.update.nonce == update.nonce
                    && e.delay.toString() == "5",
                "UpdateStaged event not emitted correctly"
            )
        })
    })

    describe("batch stageUpdate", () => {
        it("reverts when sender is not owner", async () => {
            const data0 = await setUint256Tx("0", accounts[0])
            const data1 = await setUint256Tx("1", accounts[0])
            const data2 = await setUint256Tx("5", accounts[0])

            await truffleAssert.reverts(
                governor.stage(
                    {
                        target: [setUint256.address, setUint256.address, setUint256.address],
                        value: ["0", "0", "0"],
                        data: [data0, data1, data2],
                        nonce: 1
                    },
                    "0",
                    {from: accounts[1]}
                ),
                "unauthorized: msg.sender not owner"
            )
        })

        it("reverts when an update is already staged", async () => {
            // stage a batch update
            const data0 = await setUint256Tx("0", accounts[0])
            const data1 = await setUint256Tx("1", accounts[0])
            const data2 = await setUint256Tx("5", accounts[0])
            await governor.stage(
                {
                    target: [setUint256.address, setUint256.address, setUint256.address],
                    value: ["0", "0", "0"],
                    data: [data0, data1, data2],
                    nonce: 1
                },
                "0"
            )

            // try staging the same batch update
            await truffleAssert.reverts(
                governor.stage(
                    {
                        target: [setUint256.address, setUint256.address, setUint256.address],
                        value: ["0", "0", "0"],
                        data: [data0, data1, data2],
                        nonce: 1
                    },
                    "0"
                ),
                "update already staged"
            )
        })

        it("stage emits an UpdateStaged event", async () => {
            const data0 = await setUint256Tx("0", accounts[0])
            const data1 = await setUint256Tx("1", accounts[0])
            const data2 = await setUint256Tx("5", accounts[0])

            const update = {
                target: [setUint256.address, setUint256.address, setUint256.address],
                value: ["0", "0", "0"],
                data: [data0, data1, data2],
                nonce: 1
            }

            const updateHash = getUpdateHash(update)
            const blockNum = await fixture.rpc.getBlockNumberAsync()

            const tx = await governor.stage(
                update,
                "5"
            )

            assert.equal((await governor.updates(updateHash)).toNumber(), blockNum + 5 + 1) // + 1 because stage() mines a block

            truffleAssert.eventEmitted(
                tx,
                "UpdateStaged",
                e => e.update.target[0] == update.target[0]
                    && e.update.value[0] == update.value[0]
                    && e.update.data[0] == update.data[0]
                    && e.update.target[1] == update.target[1]
                    && e.update.value[1] == update.value[1]
                    && e.update.data[1] == update.data[1]
                    && e.update.target[2] == update.target[2]
                    && e.update.value[2] == update.value[2]
                    && e.update.data[2] == update.data[2]
                    && e.update.nonce == update.nonce
                    && e.delay.toString() == "5",
                "UpdateStaged event not emitted correctly"
            )
        })
    })

    describe("cancelUpdate", async () => {
        it("reverts when msg.sender is not the owner", async () => {
            const data = await setUint256Tx("1", accounts[0])

            await truffleAssert.reverts(
                governor.cancel(
                    {
                        target: [setUint256.address],
                        value: ["0"],
                        data: [data],
                        nonce: 1
                    },
                    {from: accounts[1]}
                ),
                "unauthorized: msg.sender not owner"
            )
        })

        it("reverts when an update is not staged", async () => {
            const data = await setUint256Tx("1", accounts[0])

            await truffleAssert.reverts(
                governor.cancel(
                    {
                        target: [setUint256.address],
                        value: ["0"],
                        data: [data],
                        nonce: 1
                    }
                ),
                "update is not staged"
            )
        })

        it("cancels a staged update", async () => {
            const data = await setUint256Tx("1", accounts[0])
            const update = {
                target: [setUint256.address],
                value: ["0"],
                data: [data],
                nonce: 1
            }
            const updateHash = getUpdateHash(update)
            const blockNum = await fixture.rpc.getBlockNumberAsync()

            let tx = await governor.stage(
                update,
                "5"
            )

            assert.equal((await governor.updates(updateHash)).toNumber(), blockNum + 5 + 1) // + 1 because stage() mines a block
            truffleAssert.eventEmitted(
                tx,
                "UpdateStaged",
                e => e.update.target[0] == update.target[0]
                    && e.update.value[0] == update.value[0]
                    && e.update.data[0] == update.data[0]
                    && e.update.nonce == update.nonce
                    && e.delay.toString() == "5",
                "UpdateStaged event not emitted correctly"
            )

            tx = await governor.cancel(update)

            assert.equal((await governor.updates(updateHash)).toNumber(), 0)

            truffleAssert.eventEmitted(
                tx,
                "UpdateCancelled",
                e => e.update.target[0] == update.target[0]
                    && e.update.value[0] == update.value[0]
                    && e.update.data[0] == update.data[0]
                    && e.update.nonce == update.nonce,
                "UpdateCancelled event not emitted correctly"
            )
        })
    })

    describe("batch cancelUpdate", async () => {
        it("reverts when msg.sender is not the owner", async () => {
            const data0 = await setUint256Tx("0", accounts[0])
            const data1 = await setUint256Tx("1", accounts[0])
            const data2 = await setUint256Tx("5", accounts[0])
            await truffleAssert.reverts(
                governor.cancel(
                    {
                        target: [setUint256.address, setUint256.address, setUint256.address],
                        value: ["0", "0", "0"],
                        data: [data0, data1, data2],
                        nonce: 1
                    },
                    {from: accounts[1]}
                ),
                "unauthorized: msg.sender not owner"
            )
        })

        it("reverts when an update is not staged", async () => {
            const data0 = await setUint256Tx("0", accounts[0])
            const data1 = await setUint256Tx("1", accounts[0])
            const data2 = await setUint256Tx("5", accounts[0])
            await truffleAssert.reverts(
                governor.cancel(
                    {
                        target: [setUint256.address, setUint256.address, setUint256.address],
                        value: ["0", "0", "0"],
                        data: [data0, data1, data2],
                        nonce: 1
                    }
                ),
                "update is not staged"
            )
        })

        it("cancels a batch of staged updates", async () => {
            const data0 = await setUint256Tx("0", accounts[0])
            const data1 = await setUint256Tx("1", accounts[0])
            const data2 = await setUint256Tx("5", accounts[0])

            const update = {
                target: [setUint256.address, setUint256.address, setUint256.address],
                value: ["0", "0", "0"],
                data: [data0, data1, data2],
                nonce: 1
            }

            const updateHash = getUpdateHash(update)
            const blockNum = await fixture.rpc.getBlockNumberAsync()

            let tx = await governor.stage(
                update,
                "5"
            )

            assert.equal((await governor.updates(updateHash)).toNumber(), blockNum + 5 + 1) // + 1 because stage() mines a block
            truffleAssert.eventEmitted(
                tx,
                "UpdateStaged",
                e => e.update.target[0] == update.target[0]
                    && e.update.value[0] == update.value[0]
                    && e.update.data[0] == update.data[0]
                    && e.update.target[1] == update.target[1]
                    && e.update.value[1] == update.value[1]
                    && e.update.data[1] == update.data[1]
                    && e.update.target[2] == update.target[2]
                    && e.update.value[2] == update.value[2]
                    && e.update.data[2] == update.data[2]
                    && e.update.nonce == update.nonce
                    && e.delay.toString() == "5",
                "UpdateStaged event not emitted correctly"
            )

            tx = await governor.cancel(update)

            assert.equal((await governor.updates(updateHash)).toNumber(), 0)

            truffleAssert.eventEmitted(
                tx,
                "UpdateCancelled",
                e => e.update.target[0] == update.target[0]
                    && e.update.value[0] == update.value[0]
                    && e.update.data[0] == update.data[0]
                    && e.update.target[1] == update.target[1]
                    && e.update.value[1] == update.value[1]
                    && e.update.data[1] == update.data[1]
                    && e.update.target[2] == update.target[2]
                    && e.update.value[2] == update.value[2]
                    && e.update.data[2] == update.data[2],
                "UpdateCancelled event not emitted correctly"
            )
        })
    })

    describe("executeUpdate", () => {
        it("reverts when the update has not been staged", async () => {
            const data = await setUint256Tx("1", accounts[0])

            await truffleAssert.reverts(
                governor.execute(
                    {
                        target: [setUint256.address],
                        value: ["0"],
                        data: [data],
                        nonce: 1
                    }
                ),
                "update is not staged"
            )
        })

        it("reverts when delay for the staged update has not expired", async () => {
            const data = await setUint256Tx("1", accounts[0])

            await governor.stage(
                {
                    target: [setUint256.address],
                    value: ["0"],
                    data: [data],
                    nonce: 1
                },
                "100"
            )

            await truffleAssert.reverts(
                governor.execute(
                    {
                        target: [setUint256.address],
                        value: ["0"],
                        data: [data],
                        nonce: 1
                    }
                ),
                "delay for update not expired"
            )
        })

        it("reverts when one of the remote calls in the batch fails", async () => {
            const data = await setUint256Tx("1", accounts[0])

            await governor.stage(
                {
                    target: [setUint256.address],
                    value: ["0"],
                    data: [data],
                    nonce: 1
                },
                "100"
            )

            await setUint256.setShouldFail(true)

            await fixture.rpc.wait(101)

            // test forwarded revert reason
            await truffleAssert.reverts(governor.execute(
                {
                    target: [setUint256.address],
                    value: ["0"],
                    data: [data],
                    nonce: 1
                }
            ), "I should fail")
        })

        it("executes an update: delete the update and emit an UpdateExecuted event", async () => {
            const data = await setUint256Tx("1", accounts[0])
            const update = {
                target: [setUint256.address],
                value: ["1000"],
                data: [data],
                nonce: 1
            }
            const updateHash = getUpdateHash(update)

            await governor.stage(
                update,
                "100"
            )

            await fixture.rpc.wait(100)

            const tx = await governor.execute(update, {from: accounts[0], value: new BN(1000)})

            assert.equal((await governor.updates(updateHash)).toNumber(), 0)

            truffleAssert.eventEmitted(
                tx,
                "UpdateExecuted",
                e => e.update.target[0] == update.target[0]
                    && e.update.value[0] == update.value[0]
                    && e.update.data[0] == update.data[0]
                    && e.update.nonce == update.nonce,
                "UpdateStaged event not emitted correctly"
            )

            // check that ETH balance of target is updated
            assert.equal((await web3.eth.getBalance(update.target[0])).toString(), update.value[0])
        })
    })

    describe("batch executeUpdate", () => {
        it("reverts when the update has not been staged", async () => {
            const data0 = await setUint256Tx("0", accounts[0])
            const data1 = await setUint256Tx("1", accounts[0])
            const data2 = await setUint256Tx("5", accounts[0])

            // stage the update partially
            await governor.stage(
                {
                    target: [setUint256.address],
                    value: ["0"],
                    data: [data0],
                    nonce: 1
                },
                "100"
            )

            await truffleAssert.reverts(
                governor.execute(
                    {
                        target: [setUint256.address, setUint256.address, setUint256.address],
                        value: ["0", "0", "0"],
                        data: [data0, data1, data2],
                        nonce: 1
                    }
                ),
                "update is not staged"
            )
        })

        it("reverts when delay for the staged update has not expired", async () => {
            const data0 = await setUint256Tx("0", accounts[0])
            const data1 = await setUint256Tx("1", accounts[0])
            const data2 = await setUint256Tx("5", accounts[0])

            const update = {
                target: [setUint256.address, setUint256.address, setUint256.address],
                value: ["0", "0", "0"],
                data: [data0, data1, data2],
                nonce: 1
            }

            await governor.stage(
                update,
                "100"
            )

            await truffleAssert.reverts(
                governor.execute(update),
                "delay for update not expired"
            )
        })

        it("reverts when one of the remote calls in the batch fails", async () => {
            const data0 = await setUint256Tx("0", accounts[0])
            const data1 = await setUint256Tx("1", accounts[0])
            const data2 = await setUint256Tx("5", accounts[0])

            const update = {
                target: [setUint256.address, setUint256.address, setUint256.address],
                value: ["0", "0", "0"],
                data: [data0, data1, data2],
                nonce: 1
            }

            await governor.stage(
                update,
                "100"
            )

            await setUint256.setShouldFail(true)

            await fixture.rpc.wait(101)

            // test forwarded revert reason
            await truffleAssert.reverts(
                governor.execute(update),
                "I should fail"
            )
        })

        it("executes an update: delete the update and emit an UpdateExecuted event", async () => {
            const data0 = await setUint256Tx("0", accounts[0])
            const data1 = await setUint256Tx("1", accounts[0])
            const data2 = await setUint256Tx("5", accounts[0])

            const update = {
                target: [setUint256.address, setUint256.address, setUint256.address],
                value: ["0", "0", "0"],
                data: [data0, data1, data2],
                nonce: 1
            }
            const updateHash = getUpdateHash(update)

            await governor.stage(
                update,
                "100"
            )

            await fixture.rpc.wait(100)

            const tx = await governor.execute(update)

            assert.equal((await governor.updates(updateHash)), 0)

            truffleAssert.eventEmitted(
                tx,
                "UpdateExecuted",
                e => e.update.target[0] == update.target[0]
                    && e.update.value[0] == update.value[0]
                    && e.update.data[0] == update.data[0]
                    && e.update.target[1] == update.target[1]
                    && e.update.value[1] == update.value[1]
                    && e.update.data[1] == update.data[1]
                    && e.update.target[2] == update.target[2]
                    && e.update.value[2] == update.value[2]
                    && e.update.data[2] == update.data[2]
                    && e.update.nonce == update.nonce,
                "UpdateStaged event not emitted correctly"
            )
        })
    })
})
