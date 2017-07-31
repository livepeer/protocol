import expectThrow from "../test/helpers/expectThrow"

const OraclizeVerifier = artifacts.require("OraclizeVerifier")
const CallbackContractMock = artifacts.require("CallbackContractMock")

contract("OraclizeVerifier", accounts => {
    let verifier

    before(async () => {
        verifier = await OraclizeVerifier.new()
    })

    describe("verify", () => {
        const jobId = 0
        const segmentSequenceNumber = 0
        // IPFS hash of Dockerfile archive
        const code = "QmSQ8hVyn8N9RgU74CEbuN7WfBJ42ic7HJcATRBGxXUieN"
        // IPFS hash of test.ts
        const dataHash = "QmR9BnJQisvevpCoSVWWKyownN58nydb2zQt9Z2VtnTnKe"
        // Keccak256 hash of transcoded data from test.ts
        const transcodedDataHash = "0xd0d8ff5eecaaa738d9097aea662f9c8dac2f35636fca52aea4ba6f4f766f5137"

        let callbackContract

        before(async () => {
            callbackContract = (await CallbackContractMock.new()).address
        })

        it("should throw if insufficient funds for Oraclize", async () => {
            await expectThrow(verifier.verify(jobId, segmentSequenceNumber, code, dataHash, transcodedDataHash, callbackContract))
        })

        it("should trigger async callback from Oraclize", async () => {
            const e = verifier.OraclizeCallback({})

            e.watch(async (err, result) => {
                e.stopWatching()

                assert.equal(result.args.jobId, jobId, "callback job id incorrect")
                assert.equal(result.args.segmentSequenceNumber, segmentSequenceNumber, "callback segment sequence number incorrect")
                assert.equal(result.args.result, true, "callback result incorrect")
            })

            await verifier.verify(jobId, segmentSequenceNumber, code, dataHash, transcodedDataHash, callbackContract, {from: accounts[0], value: web3.toWei(1, "ether")})
        })
    })

    describe("__callback", () => {
        it("should throw if sender is not Oraclize", async () => {
            await expectThrow(verifier.__callback("0x123", "foo"))
        })
    })
})
