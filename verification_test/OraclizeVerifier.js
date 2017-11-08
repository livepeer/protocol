import Fixture from "../test/helpers/fixture"
import expectThrow from "../test/helpers/expectThrow"
import BigNumber from "bignumber.js"

const OraclizeVerifier = artifacts.require("OraclizeVerifier")

const GAS_PRICE = new BigNumber(web3.toWei(20, "gwei"))
const GAS_LIMIT = 3000000

contract("OraclizeVerifier", accounts => {
    let fixture
    let verifier

    // IPFS hash of Dockerfile archive
    const codeHash = "QmXKxSKhUZnmjb53HzS94arpshet3N5Kmct8JBAsgm9umR"

    before(async () => {
        fixture = new Fixture(web3)
        await fixture.deployController()
        await fixture.deployMocks()
        verifier = await OraclizeVerifier.new(fixture.controller.address, codeHash, GAS_PRICE, GAS_LIMIT)
        await fixture.jobsManager.setVerifier(verifier.address)
    })

    describe("verificationCodeHash", () => {
        it("should return the verification code hash", async () => {
            const hash = await verifier.verificationCodeHash.call()
            assert.equal(hash, codeHash, "verification code hash incorrect")
        })
    })

    describe("verify", () => {
        const jobId = 0
        const claimId = 0
        const segmentNumber = 0
        const transcodingOptions = "P720p60fps16x9,P720p30fps16x9"
        // IPFS hash of seg.ts
        const dataStorageHash = "QmR9BnJQisvevpCoSVWWKyownN58nydb2zQt9Z2VtnTnKe"
        // Keccak256 hash of segment data
        const dataHash = "0xcda2f677da4cdf85364c90a85a8ecfdaa8b5677aeca346efa2a5247654079a29"
        // Keccak256 hash of transcoded data
        const transcodedDataHash = "0x77903c5de84acf703524da5547df170612ab9308edfec742f5f22f5dc0cfb76a"

        const dataHashes = [dataHash, transcodedDataHash]

        it("should trigger async callback from Oraclize", async () => {
            const e = verifier.OraclizeCallback({})

            e.watch(async (err, result) => {
                e.stopWatching()

                assert.equal(result.args.jobId, jobId, "callback job id incorrect")
                assert.equal(result.args.claimId, claimId, "callback claim id incorrect")
                assert.equal(result.args.segmentNumber, segmentNumber, "callback segment sequence number incorrect")
                assert.equal(result.args.result, true, "callback result incorrect")
            })

            await fixture.jobsManager.setVerifyParams(jobId, claimId, segmentNumber, transcodingOptions, dataStorageHash, dataHashes)

            const price = await verifier.getPrice()
            await fixture.jobsManager.callVerify({from: accounts[0], value: price})
        })
    })

    describe("__callback", () => {
        it("should throw if sender is not Oraclize", async () => {
            await expectThrow(verifier.__callback("0x123", "foo"))
        })
    })
})
