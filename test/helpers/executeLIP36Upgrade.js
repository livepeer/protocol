const BondingManager = artifacts.require("BondingManager")
const LinkedList = artifacts.require("SortedDoublyLL")
const AdjustableRoundsManager = artifacts.require("AdjustableRoundsManager")

const {contractId} = require("../../utils/helpers")
import BN from "bn.js"

module.exports = async function(controller, roundsManager, bondingManagerProxyAddress) {
    // See Deployment section of https://github.com/livepeer/LIPs/blob/master/LIPs/LIP-36.md

    // Define LIP-36 round
    const lip36Round = await roundsManager.currentRound()

    // Deploy a new RoundsManager implementation contract
    // Note: In this test, we use the same implementation contract as the one currently deployed because
    // this repo does not contain the old implementation contract. In practice, the deployed implementation contract
    // would be different than the new implementation contract and we would be using the RoundsManager instead of the AdjustableRoundsManager
    const roundsManagerTarget = await AdjustableRoundsManager.new(controller.address)

    // Deploy a new BondingManager implementation contract
    const ll = await LinkedList.deployed()
    BondingManager.link("SortedDoublyLL", ll.address)
    const bondingManagerTarget = await BondingManager.new(controller.address)

    // Register the new RoundsManager implementation contract
    await controller.setContractInfo(contractId("RoundsManagerTarget"), roundsManagerTarget.address, web3.utils.asciiToHex("0x123"))

    // Set LIP upgrade round
    await roundsManager.setLIPUpgradeRound(new BN(36), lip36Round)

    // Register the new BondingManager implementation contract
    await controller.setContractInfo(contractId("BondingManagerTarget"), bondingManagerTarget.address, web3.utils.asciiToHex("0x123"))

    return await BondingManager.at(bondingManagerProxyAddress)
}
