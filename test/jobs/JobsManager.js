import RPC from "../../utils/rpc"
import expectThrow from "../helpers/expectThrow"

var LivepeerProtocol = artifacts.require("LivepeerProtocol")
var LivepeerToken = artifacts.require("LivepeerToken")
var BondingManager = artifacts.require("BondingManager")
var JobsManager = artifacts.require("JobsManager")

contract("JobsManager", accounts => {
    let rpc
    let jobsManager

    beforeEach(async () => {
        rpc = new RPC(web3)
        jobsManager = await JobsManager.new()

        const protocol = await LivepeerProtocol.new()
        const token = await LivepeerToken.new()
        const bondingManager = await BondingManager.new(token.address)
        const bondingManagerKey = await protocol.bondingManagerKey.call()

        await protocol.setRegistryContract(bondingManagerKey, bondingManager.address)
        await jobsManager.initialize(protocol.address)
    })

    describe("job", () => {
        it("should create a new job", async () => {
        })
    })
})
