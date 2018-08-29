import Fixture from "./helpers/Fixture"
import expectThrow from "../helpers/expectThrow"
import {functionEncodedABI} from "../../utils/helpers"
import {constants} from "../../utils/constants"
import ethUtil from "ethereumjs-util"
import ethAbi from "ethereumjs-abi"

const LivepeerVerifier = artifacts.require("LivepeerVerifier")

contract("LivepeerVerifier", accounts => {
    const solver = accounts[1]
    // IPFS hash of Dockerfile archive
    const codeHash = "QmZmvi1BaYSdxM1Tgwhi2mURabh46xCkzuH9PWeAkAZZGc"

    describe("constructor", () => {
        it("should fail if a provided solver address is the null address", async () => {
            await expectThrow(LivepeerVerifier.new(accounts[0], constants.NULL_ADDRESS, codeHash))
        })

        it("should create contract", async () => {
            const verifier = await LivepeerVerifier.new(accounts[0], solver, codeHash)

            assert.equal(await verifier.solver.call(), solver, "should set provided solver address as solver")
            assert.equal(await verifier.verificationCodeHash.call(), codeHash, "should set verificationCodeHash")
        })
    })

    let fixture
    let verifier

    before(async () => {
        fixture = new Fixture(web3)
        await fixture.deploy()

        verifier = await fixture.deployAndRegister(LivepeerVerifier, "Verifier", fixture.controller.address, solver, codeHash)
    })

    beforeEach(async () => {
        await fixture.setUp()
    })

    afterEach(async () => {
        await fixture.tearDown()
    })

    describe("setVerificationCodeHash", () => {
        it("should fail if caller is not Controller owner", async () => {
            await expectThrow(verifier.setVerificationCodeHash("foo", {from: accounts[1]}))
        })

        it("should set verificationCodeHash", async () => {
            await verifier.setVerificationCodeHash("foo")

            assert.equal(await verifier.verificationCodeHash.call(), "foo", "should set verificationCodeHash")
        })
    })

    describe("setSolver", () => {
        it("should fail if caller is not Controller owner", async () => {
            await expectThrow(verifier.setSolver(accounts[4], {from: accounts[1]}))
        })

        it("should fail for null address", async () => {
            await expectThrow(verifier.setSolver(constants.NULL_ADDRESS))
        })

        it("should register a new solver", async () => {
            await verifier.setSolver(accounts[3])

            assert.equal(await verifier.solver.call(), accounts[3], "wrong solver address")
        })

        it("should fire a SolverUpdate event", async () => {
            let e = verifier.SolverUpdate({})

            e.watch(async (err, result) => {
                e.stopWatching()

                assert.equal(result.args.solver, accounts[3], "wrong solver address in SolverUpdate event")
            })

            await verifier.setSolver(accounts[3])
        })
    })

    describe("verify", () => {
        const jobId = 0
        const claimId = 0
        const segmentNumber = 0
        const transcodingOptions = "0x123"
        const dataStorageHash = "0x123"
        const dataHashes = [web3.sha3("apple"), web3.sha3("pear")]

        it("should fail if sender is not the JobsManager", async () => {
            await expectThrow(verifier.verify(jobId, claimId, segmentNumber, transcodingOptions, dataStorageHash, dataHashes))
        })

        it("should store a request", async () => {
            await fixture.jobsManager.execute(
                verifier.address,
                functionEncodedABI(
                    "verify(uint256,uint256,uint256,string,string,bytes32[2])",
                    ["uint256", "uint256", "uint256", "string", "string", "bytes32[2]"],
                    [jobId, claimId, segmentNumber, transcodingOptions, dataStorageHash, dataHashes]
                )
            )

            const commitHash = ethUtil.bufferToHex(ethAbi.soliditySHA3(["bytes", "bytes"], [ethUtil.toBuffer(dataHashes[0]), ethUtil.toBuffer(dataHashes[1])]))

            const request = await verifier.requests.call(0)
            assert.equal(request[0], jobId, "job id incorrect")
            assert.equal(request[1], claimId, "claim id incorrect")
            assert.equal(request[2], segmentNumber, "segment number incorrect")
            assert.equal(request[3], commitHash, "commit hash incorrect")

            assert.equal(await verifier.requestCount.call(), 1, "should increment requestCount by 1")
        })

        it("should fire a VerifyRequest event", async () => {
            let e = verifier.VerifyRequest({})

            e.watch(async (err, result) => {
                e.stopWatching()

                assert.equal(result.args.requestId, 0, "event requestId incorrect")
                assert.equal(result.args.jobId, jobId, "event jobId incorrect")
                assert.equal(result.args.claimId, claimId, "event claimId incorrect")
                assert.equal(result.args.segmentNumber, segmentNumber, "event segmentNumber incorrect")
                assert.equal(result.args.transcodingOptions, transcodingOptions, "event transcodingOptions incorrect")
                assert.equal(result.args.dataStorageHash, dataStorageHash, "event dataStorageHash incorrect")
                assert.equal(result.args.dataHash, dataHashes[0], "event dataHash incorrect")
                assert.equal(result.args.transcodedDataHash, dataHashes[1], "event transcodedDataHash incorrect")
            })

            await fixture.jobsManager.execute(
                verifier.address,
                functionEncodedABI(
                    "verify(uint256,uint256,uint256,string,string,bytes32[2])",
                    ["uint256", "uint256", "uint256", "string", "string", "bytes32[2]"],
                    [jobId, claimId, segmentNumber, transcodingOptions, dataStorageHash, dataHashes]
                )
            )
        })
    })

    describe("__callback", () => {
        const jobId = 0
        const claimId = 0
        const segmentNumber = 0
        const transcodingOptions = "0x123"
        const dataStorageHash = "0x123"
        const dataHashes = [web3.sha3("apple"), web3.sha3("pear")]

        it("should fail if sender is not a solver", async () => {
            await expectThrow(verifier.__callback(0, "0x123", {from: accounts[3]}))
        })

        it("should delete stored request", async () => {
            await fixture.jobsManager.execute(
                verifier.address,
                functionEncodedABI(
                    "verify(uint256,uint256,uint256,string,string,bytes32[2])",
                    ["uint256", "uint256", "uint256", "string", "string", "bytes32[2]"],
                    [jobId, claimId, segmentNumber, transcodingOptions, dataStorageHash, dataHashes]
                )
            )

            const commitHash = ethUtil.bufferToHex(ethAbi.soliditySHA3(["bytes", "bytes"], [ethUtil.toBuffer(dataHashes[0]), ethUtil.toBuffer(dataHashes[1])]))
            await verifier.__callback(0, commitHash, {from: solver})

            const request = await verifier.requests.call(0)
            assert.equal(request[0], 0, "should zero out jobId")
            assert.equal(request[1], 0, "should zero out claimId")
            assert.equal(request[2], 0, "should zero out segmentNumber")
            assert.equal(request[3], constants.NULL_BYTES, "should zero out commitHash")
        })

        it("should fire a callback event with result set to true if verification succeeded", async () => {
            await fixture.jobsManager.execute(
                verifier.address,
                functionEncodedABI(
                    "verify(uint256,uint256,uint256,string,string,bytes32[2])",
                    ["uint256", "uint256", "uint256", "string", "string", "bytes32[2]"],
                    [jobId, claimId, segmentNumber, transcodingOptions, dataStorageHash, dataHashes]
                )
            )

            let e = verifier.Callback({})

            e.watch(async (err, result) => {
                e.stopWatching()

                assert.equal(result.args.requestId, 0, "callback requestId incorrect")
                assert.equal(result.args.jobId, jobId, "callback jobId incorrect")
                assert.equal(result.args.claimId, claimId, "callback claimId incorrect")
                assert.equal(result.args.segmentNumber, segmentNumber, "callback segmentNumber incorrect")
                assert.equal(result.args.result, true, "callback result incorrect")
            })

            const commitHash = ethUtil.bufferToHex(ethAbi.soliditySHA3(["bytes", "bytes"], [ethUtil.toBuffer(dataHashes[0]), ethUtil.toBuffer(dataHashes[1])]))
            await verifier.__callback(0, commitHash, {from: solver})
        })

        it("should fire a callback event with result set to false if verification failed", async () => {
            await fixture.jobsManager.execute(
                verifier.address,
                functionEncodedABI(
                    "verify(uint256,uint256,uint256,string,string,bytes32[2])",
                    ["uint256", "uint256", "uint256", "string", "string", "bytes32[2]"],
                    [jobId, claimId, segmentNumber, transcodingOptions, dataStorageHash, dataHashes]
                )
            )

            let e = verifier.Callback({})

            e.watch(async (err, result) => {
                e.stopWatching()

                assert.equal(result.args.requestId, 0, "callback requestId incorrect")
                assert.equal(result.args.jobId, jobId, "callback jobId incorrect")
                assert.equal(result.args.claimId, claimId, "callback claimId incorrect")
                assert.equal(result.args.segmentNumber, segmentNumber, "callback segmentNumber incorrect")
                assert.equal(result.args.result, false, "callback result incorrect")
            })

            const wrongCommitHash = ethUtil.bufferToHex(ethAbi.soliditySHA3(["bytes", "bytes"], [ethUtil.toBuffer(dataHashes[0]), ethUtil.toBuffer(web3.sha3("not pear"))]))
            await verifier.__callback(0, wrongCommitHash, {from: solver})
        })
    })

    describe("getPrice", () => {
        it("should return 0", async () => {
            assert.equal(await verifier.getPrice(), 0, "should return a price of 0")
        })
    })
})
