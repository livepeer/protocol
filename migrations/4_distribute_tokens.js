const LivepeerToken = artifacts.require("LivepeerToken")

module.exports = function(deployer, network, accounts) {
    if (network == "development") {
        deployer.then(() => {
            return LivepeerToken.deployed()
        }).then(token => {
            return Promise.all([
                token.mint(accounts[0], 10000000000),
                token.mint(accounts[1], 10000000000),
                token.mint(accounts[2], 10000000000),
                token.mint(accounts[3], 10000000000)
            ])
        })
    }
}
