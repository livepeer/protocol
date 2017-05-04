var LivepeerToken = artifacts.require("./LivepeerToken.sol");
var LivepeerProtocol = artifacts.require("./LivepeerProtocol.sol");
var MinHeapMock = artifacts.require("./MinHeapMock.sol");
var MinHeap = artifacts.require("./MinHeap.sol");

module.exports = function(deployer) {
    deployer.deploy(LivepeerToken);
    deployer.link(LivepeerToken, LivepeerProtocol);
    deployer.deploy(LivepeerProtocol);

    deployer.deploy(MinHeap);
    deployer.link(MinHeap, MinHeapMock);
};
