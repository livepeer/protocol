var LivepeerToken = artifacts.require("./LivepeerToken.sol");
var LivepeerProtocol = artifacts.require("./LivepeerProtocol.sol");

module.exports = function(deployer) {
    deployer.deploy(LivepeerToken);
    deployer.link(LivepeerToken, LivepeerProtocol);
    deployer.deploy(LivepeerProtocol);
};
