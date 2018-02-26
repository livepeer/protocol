import Fixture from "./helpers/Fixture"
import expectThrow from "../helpers/expectThrow"
import {contractId} from "../../utils/helpers"
import ethUtil from "ethereumjs-util"
import ethAbi from "ethereumjs-abi"

const ManagerProxy = artifacts.require("ManagerProxy")
const ManagerProxyTargetMockV1 = artifacts.require("ManagerProxyTargetMockV1")
const ManagerProxyTargetMockV2 = artifacts.require("ManagerProxyTargetMockV2")
const ManagerProxyTargetMockV3 = artifacts.require("ManagerProxyTargetMockV3")

contract("ManagerProxy", accounts => {
    let fixture
    let managerProxy

    describe("constructor", () => {
        it("should create contract", async () => {
            const targetContractId = contractId("ManagerProxyTarget")
            const proxy = await ManagerProxy.new(accounts[0], targetContractId)

            assert.equal(await proxy.controller.call(), accounts[0], "should set Controller address")
            assert.equal(await proxy.targetContractId.call(), targetContractId, "should set target contract ID")
        })
    })

    before(async () => {
        fixture = new Fixture(web3)
        await fixture.deploy()
        await fixture.deployAndRegister(ManagerProxyTargetMockV1, "ManagerProxyTarget", fixture.controller.address)

        const proxy = await ManagerProxy.new(fixture.controller.address, contractId("ManagerProxyTarget"))
        managerProxy = await ManagerProxyTargetMockV1.at(proxy.address)
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("fallback function", () => {
        it("should fail if there is no valid contract address registered with the Controller for the target contract ID", async () => {
            const newProxy = await ManagerProxy.new(fixture.controller.address, contractId("foo"))
            const target = await ManagerProxyTargetMockV1.at(newProxy.address)

            await expectThrow(target.setUint64(5))
        })

        describe("setting and getting uint8", () => {
            it("should set a uint8", async () => {
                await managerProxy.setUint8(4)

                const value = await managerProxy.uint8Value.call()
                assert.equal(value, 4, "uint8 value incorrect")
            })
        })

        describe("setting and getting uint64", () => {
            it("should set a uint64", async () => {
                await managerProxy.setUint64(5)

                const value = await managerProxy.uint64Value.call()
                assert.equal(value, 5, "uint64 value incorrect")
            })
        })

        describe("setting and getting uint256", () => {
            it("should set a uint256", async () => {
                await managerProxy.setUint256(6)

                const value = await managerProxy.uint256Value.call()
                assert.equal(value, 6, "uint256 value incorrect")
            })
        })

        describe("setting and getting bytes32", () => {
            const hash = web3.sha3("hello")

            it("should set a bytes32", async () => {
                await managerProxy.setBytes32(hash)

                const value = await managerProxy.bytes32Value.call()
                assert.equal(value, hash, "bytes32 value incorrect")
            })
        })

        describe("setting and getting address", () => {
            const addr = accounts[1]

            it("should set an address", async () => {
                await managerProxy.setAddress(addr)

                const value = await managerProxy.addressValue.call()
                assert.equal(value, addr, "address value incorrect")
            })
        })

        describe("setting and getting string", () => {
            const str = "hello"

            it("should set a string", async () => {
                await managerProxy.setString(str)

                const value = await managerProxy.stringValue.call()
                assert.equal(value, str, "string value incorrect")
            })
        })

        describe("setting and getting bytes", () => {
            const h = web3.sha3("hello")

            it("should set a bytes", async () => {
                await managerProxy.setBytes(h)

                const value = await managerProxy.bytesValue.call()
                assert.equal(value, h, "bytes value incorrect")
            })
        })

        describe("setting and getting a tuple", () => {
            const v1 = 5
            const v2 = 6
            const v3 = web3.sha3("hello")

            it("should set a tuple", async () => {
                await managerProxy.setTuple(v1, v2, v3)

                const values = await managerProxy.getTuple()
                assert.equal(values[0], v1, "tuple value 1 incorrect")
                assert.equal(values[1], v2, "tuple value 2 incorrect")
                assert.equal(values[2], v3, "tuple value 3 incorrect")
            })
        })
    })

    describe("non-storage upgrade", () => {
        beforeEach(async () => {
            await managerProxy.setUint8(4)
            await managerProxy.setUint64(5)
            await managerProxy.setUint256(6)
            await managerProxy.setBytes32(web3.sha3("hello"))
            await managerProxy.setAddress(accounts[1])
        })

        it("should preserve state in proxy contract", async () => {
            await fixture.deployAndRegister(ManagerProxyTargetMockV2, "ManagerProxyTarget", [fixture.controller.address])

            const uint8Value = await managerProxy.uint8Value.call()
            assert.equal(uint8Value, 4, "uint8 value incorrect")
            const uint64Value = await managerProxy.uint64Value.call()
            assert.equal(uint64Value, 5, "uint64 value incorrect")
            const uint256Value = await managerProxy.uint256Value.call()
            assert.equal(uint256Value, 6, "uint256 value incorrect")
            const bytes32Value = await managerProxy.bytes32Value.call()
            assert.equal(bytes32Value, web3.sha3("hello"), "bytes32 value incorrect")
            const addressValue = await managerProxy.addressValue.call()
            assert.equal(addressValue, accounts[1], "address value incorrect")
        })

        it("should set a uint8 and add 5", async () => {
            await fixture.deployAndRegister(ManagerProxyTargetMockV2, "ManagerProxyTarget", [fixture.controller.address])
            await managerProxy.setUint8(10)

            const value = await managerProxy.uint8Value.call()
            assert.equal(value, 10 + 5, "uint8 value incorrect")
        })

        it("should set a uint64 and add 5", async () => {
            await fixture.deployAndRegister(ManagerProxyTargetMockV2, "ManagerProxyTarget", [fixture.controller.address])
            await managerProxy.setUint64(10)

            const value = await managerProxy.uint64Value.call()
            assert.equal(value, 10 + 5, "uint64 value incorrect")
        })

        it("should set a uint256 and add 5", async () => {
            await fixture.deployAndRegister(ManagerProxyTargetMockV2, "ManagerProxyTarget", [fixture.controller.address])
            await managerProxy.setUint256(10)

            const value = await managerProxy.uint256Value.call()
            assert.equal(value, 10 + 5, "uint256 value incorrect")
        })

        it("should set a hashed bytes32", async () => {
            await fixture.deployAndRegister(ManagerProxyTargetMockV2, "ManagerProxyTarget", [fixture.controller.address])
            await managerProxy.setBytes32(web3.sha3("bye"))

            const value = await managerProxy.bytes32Value.call()
            assert.equal(value, ethUtil.bufferToHex(ethAbi.soliditySHA3(["bytes"], [ethUtil.toBuffer(web3.sha3("bye"))])), "bytes32 value incorrect")
        })

        it("should set a null address", async () => {
            await fixture.deployAndRegister(ManagerProxyTargetMockV2, "ManagerProxyTarget", [fixture.controller.address])
            await managerProxy.setAddress(accounts[1])

            const value = await managerProxy.addressValue.call()
            assert.equal(value, "0x0000000000000000000000000000000000000000", "address value incorrect")
        })
    })

    describe("storage upgrade with superset of original storage variables", () => {
        beforeEach(async () => {
            await managerProxy.setUint8(4)
            await managerProxy.setUint64(5)
            await managerProxy.setUint256(6)
            await managerProxy.setBytes32(web3.sha3("hello"))
            await managerProxy.setAddress(accounts[1])
        })

        it("should set a key value pair in mapping", async () => {
            await fixture.deployAndRegister(ManagerProxyTargetMockV3, "ManagerProxyTarget", [fixture.controller.address])
            // Need new contract binding since we added a new method
            const managerProxyV3 = await ManagerProxyTargetMockV3.at(managerProxy.address)
            await managerProxyV3.setKv(5, 6)

            const value = await managerProxyV3.kvMap.call(5)
            assert.equal(value, 6, "value for key incorrect")
        })

        it("should preserve old state in proxy contract after an update to a new storage variable", async () => {
            await fixture.deployAndRegister(ManagerProxyTargetMockV3, "ManagerProxyTarget", [fixture.controller.address])
            // Need new contract binding since we added a new method
            const managerProxyV3 = await ManagerProxyTargetMockV3.at(managerProxy.address)
            await managerProxyV3.setKv(5, 6)

            const uint8Value = await managerProxy.uint8Value.call()
            assert.equal(uint8Value, 4, "uint8 value incorrect")
            const uint64Value = await managerProxy.uint64Value.call()
            assert.equal(uint64Value, 5, "uint64 value incorrect")
            const uint256Value = await managerProxy.uint256Value.call()
            assert.equal(uint256Value, 6, "uint256 value incorrect")
            const bytes32Value = await managerProxy.bytes32Value.call()
            assert.equal(bytes32Value, web3.sha3("hello"), "bytes32 value incorrect")
            const addressValue = await managerProxy.addressValue.call()
            assert.equal(addressValue, accounts[1], "address value incorrect")
        })
    })
})
