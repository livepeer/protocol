const config = require("./migrations.config.js")

const Controller = artifacts.require("Controller")
const Minter = artifacts.require("Minter")
const BondingManager = artifacts.require("BondingManager")
const JobsManager = artifacts.require("JobsManager")
const RoundsManager = artifacts.require("RoundsManager")
const IdentityVerifier = artifacts.require("IdentityVerifier")
const OraclizeVerifier = artifacts.require("OraclizeVerifier")
const LivepeerToken = artifacts.require("LivepeerToken")

module.exports = function(deployer, network) {
    deployer.deploy(
        Controller
    ).then(() => {
        // Deploy non-upgradeable contracts
        return deployer.deploy([
            [LivepeerToken, Controller.address],
            [Minter, Controller.address, config.minter.initialTokenSupply, config.minter.yearlyInflation]
        ])
    }).then(() => {
        // Deploy Verifier
        if (network == "development") {
            return deployer.deploy(IdentityVerifier, Controller.address)
        } else {
            return deployer.deploy(OraclizeVerifier, Controller.address, config.verifier.verificationCodeHash, config.verifier.gasPrice, config.verifier.gasLimit)
        }
    }).then(() => {
        // Deploy upgradeable proxy target contracts
        return deployer.deploy([
            [BondingManager, Controller.address],
            [JobsManager, Controller.address],
            [RoundsManager, Controller.address]
        ])
    })
}
