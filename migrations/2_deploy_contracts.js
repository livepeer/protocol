var LivepeerToken = artifacts.require("./LivepeerToken.sol");
var LivepeerProtocol = artifacts.require("./LivepeerProtocol.sol");
var MinHeapMock = artifacts.require("./MinHeapMock.sol");
var MaxHeapMock = artifacts.require("./MaxHeapMock.sol");
var MinHeap = artifacts.require("./MinHeap.sol");
var MaxHeap = artifacts.require("./MaxHeap.sol");

module.exports = function(deployer) {
    deployer.deploy(MinHeap);
    deployer.link(MinHeap, MinHeapMock);

    deployer.deploy(MaxHeap);
    deployer.link(MaxHeap, MaxHeapMock);

    deployer.deploy(LivepeerToken);
    deployer.link(LivepeerToken, LivepeerProtocol);
    deployer.link(MinHeap, LivepeerProtocol);
    deployer.link(MaxHeap, LivepeerProtocol);
    deployer.deploy(LivepeerProtocol);
};
