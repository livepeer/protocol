import RPC from "../utils/rpc"
import expectThrow from "./helpers/expectThrow"

var LivepeerProtocol = artifacts.require("LivepeerProtocol")
var LivepeerToken = artifacts.require("LivepeerToken")
var BondingManager = artifacts.require("BondingManager")
var RoundsManager = artifacts.require("RoundsManager")
var JobsManager = artifacts.require("JobsManager")

contract("LivepeerProtocolIntegration", accounts => {
    let rpc
    let token
    let bondingManager
    let roundsManager
    let jobsManager

    beforeEach(async () => {
        rpc = new RPC(web3)

        token = await LivepeerToken.new()
        bondingManager = await BondingManager.new(token.address)
        roundsManager = await RoundsManager.new()
        jobsManager = await JobsManager.new()

        const protocol = await LivepeerProtocol.new()
        const bondingManagerKey = await protocol.bondingManagerKey.call()
        const roundsManagerKey = await protocol.roundsManagerKey.call()
        const jobsManagerKey = await protocol.jobsManagerKey.call()

        await protocol.setRegistryContract(bondingManagerKey, bondingManager.address)
        await protocol.setRegistryContract(roundsManagerKey, roundsManager.address)
        await protocol.setRegistryContract(jobsManagerKey, jobsManager.address)
        await bondingManager.initialize(protocol.address)
        await roundsManager.initialize(protocol.address)
        await jobsManager.initialize(protocol.address)
    })

    describe("reward flow", () => {

    })

    describe("job-claim-verify loop", () => {

    })
})
