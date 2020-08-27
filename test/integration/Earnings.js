const Controller = artifacts.require("Controller")
const BondingManager = artifacts.require("BondingManager")
const AdjustableRoundsManager = artifacts.require("AdjustableRoundsManager")
const LivepeerToken = artifacts.require("LivepeerToken")
const Minter = artifacts.require("Minter")
const TicketBroker = artifacts.require("TicketBroker")

const { constants } = require("../../utils/constants")


contract("Earnigns", accounts => {
    let controller
    let bondingManager
    let roundsManager
    let token
    let minter
    let broker 

    const transcoder = accounts[0]
    const broadcaster = accounts[1]
    const delegator = accounts[2] 

    const rewardCut = 50 * constants.PERC_MULTIPLIER // 50%
    const feeShare = 25 * constants.PERC_MULTIPLIER // 5%

    const transcoderStake = 1000 
    const delegatorStake = 3000 

    before(async () => {

        controller = await Controller.deployed()
        await controller.unpause()

        const bondingManagerAddr = await controller.getContract(contractId("BondingManager"))
        bondingManager = await BondingManager.at(bondingManagerAddr)

        const roundsManagerAddr = await controller.getContract(contractId("RoundsManager"))
        roundsManager = await AdjustableRoundsManager.at(roundsManagerAddr)

        const tokenAddr = await controller.getContract(contractId("LivepeerToken"))
        token = await LivepeerToken.at(tokenAddr)

        const minterAddr = await controller.getContract(contractId("Minter"))
        minter = await Minter.at(minterAddr)

        const brokerAddr = await controller.getContract(contractId("JobsManager"))
        broker = await TicketBroker.at(brokerAddr)

        // transfer tokens to transcoder and delegator
        const amount = new BN(10).mul(constants.TOKEN_UNIT)
        await token.transfer(transcoder, amount, {from: accounts[0]})
        await token.transfer(delegator, amount, {from: accounts[0]})

        // Register transcoder 
        await token.approve(bondingManager.address, transcoderStake, {from: transcoder})
        await bondingManager.bond(transcodeStake, transcoder1, {from: transcoder})
        await bondingManager.transcoder(rewardCut * constants.PERC_MULTIPLIER, feeShare * constants.PERC_MULTIPLIER, {from: transcoder})

        // Delegate from delegator
        await token.approve(bondingManager.address, delegatorStake, {from: delegator})
        await bondingManager.bond(delegatorStake, transcoder, {from: delegator})


    })
})