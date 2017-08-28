const ethAbi = require("ethereumjs-abi")
const ethUtil = require("ethereumjs-util")

const JobsManager = artifacts.require("JobsManager")
const BondingManager = artifacts.require("BondingManager")
const RoundsManager = artifacts.require("RoundsManager")
const LivepeerProtocol = artifacts.require("LivepeerProtocol")
const LivepeerToken = artifacts.require("LivepeerToken")

module.exports = function(deployer) {
    let protocol
    let token

    deployer.then(() => {
        return Promise.all([
            LivepeerProtocol.deployed(),
            LivepeerToken.deployed()
        ])
    }).then(instances => {
        [protocol, token] = instances

        return Promise.all([
            protocol.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["BondingManager"])), BondingManager.address),
            protocol.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["JobsManager"])), JobsManager.address),
            protocol.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["RoundsManager"])), RoundsManager.address)
        ])
    }).then(() => {
        return token.transferOwnership(BondingManager.address)
    }).then(() => {
        return protocol.unpause()
    })
}
