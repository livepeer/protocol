import Fixture from "../test/helpers/fixture"
import expectThrow from "../test/helpers/expectThrow"
import BigNumber from "bignumber.js"

const OraclizeVerifier = artifacts.require("OraclizeVerifier")

const GAS_PRICE = new BigNumber(web3.toWei(20, "gwei"))
const GAS_LIMIT = 3000000

contract("OraclizeVerifier", accounts => {
    let fixture
    let verifier

    before(async () => {
        fixture = new Fixture(web3)
        await fixture.deployController()
        await fixture.deployMocks()
        // IPFS hash of Dockerfile archive
        const codeHash = "QmY8eJHcKPsr4Z8GiEi1M9uX9MMsHqh96EJzXx7f69MadQ"
        verifier = await OraclizeVerifier.new(fixture.controller.address, codeHash, GAS_PRICE, GAS_LIMIT)
        await fixture.jobsManager.setVerifier(verifier.address)
    })

    describe("verify", () => {
        const jobId = 0
        const claimId = 0
        const segmentNumber = 0
        const transcodingOptions = "P720p60fps16x9,P720p30fps16x9"
        // IPFS hash of seg.ts
        const dataStorageHash = "QmR9BnJQisvevpCoSVWWKyownN58nydb2zQt9Z2VtnTnKe"
        // Keccak256 hash of transcoded data
        const transcodedDataHash = "0x6644a3057b9d236bcc3b632068af92d008b2f4baf20ae9b78052ea75f729cedf"

        it("should trigger async callback from Oraclize", async () => {
            const e = verifier.OraclizeCallback({})

            e.watch(async (err, result) => {
                e.stopWatching()

                assert.equal(result.args.jobId, jobId, "callback job id incorrect")
                assert.equal(result.args.claimId, claimId, "callback claim id incorrect")
                assert.equal(result.args.segmentNumber, segmentNumber, "callback segment sequence number incorrect")
                assert.equal(result.args.result, true, "callback result incorrect")
            })

            await fixture.jobsManager.setVerifyParams(jobId, claimId, segmentNumber, transcodingOptions, dataStorageHash, transcodedDataHash)

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
