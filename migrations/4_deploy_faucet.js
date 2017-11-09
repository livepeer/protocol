const config = require("./migrations.config.js")
const BigNumber = require("bignumber.js")
const ethUtil = require("ethereumjs-util")
const ethAbi = require("ethereumjs-abi")

const Controller = artifacts.require("Controller")
const LivepeerToken = artifacts.require("LivepeerToken")
const LivepeerTokenFaucet = artifacts.require("LivepeerTokenFaucet")

module.exports = function(deployer, network, accounts) {
    deployer.deploy(
        LivepeerTokenFaucet,
        LivepeerToken.address,
        config.faucet.requestAmount,
        config.faucet.requestWait
    ).then(() => {
        return LivepeerToken.deployed()
    }).then(token => {
        return token.mint(LivepeerTokenFaucet.address, new BigNumber(config.faucet.faucetAmount))
    }).then(() => {
        return LivepeerTokenFaucet.deployed()
    }).then(faucet => {
        return Promise.all(config.faucet.whitelist.map(addr => {
            return faucet.addToWhitelist(addr)
        }))
    }).then(() => {
        return Controller.deployed()
    }).then(controller => {
        return controller.setContract(ethUtil.bufferToHex(ethAbi.soliditySHA3(["string"], ["LivepeerTokenFaucet"])), LivepeerTokenFaucet.address)
    })
}
