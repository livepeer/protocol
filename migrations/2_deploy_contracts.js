var LivepeerToken = artifacts.require("./LivepeerToken.sol");
var LivepeerProtocol = artifacts.require("./LivepeerProtocol.sol");
var MinHeap = artifacts.require("./MinHeap.sol");
var MaxHeap = artifacts.require("./MaxHeap.sol");
var MinHeapMock = artifacts.require("./MinHeapMock.sol");
var MaxHeapMock = artifacts.require("./MaxHeapMock.sol");
var TranscoderPools = artifacts.require("./TranscoderPools.sol");
var TranscoderPoolsMock = artifacts.require("./TranscoderPoolsMock.sol");
var Node = artifacts.require("./Node.sol");
var ECVerify = artifacts.require("./ECVerify.sol");
var MerkleProof = artifacts.require("./MerkleProof.sol");

module.exports = function(deployer) {
    deployer.deploy(Node);
    deployer.link(Node, MinHeap);
    deployer.link(Node, MaxHeap);
    deployer.link(Node, LivepeerProtocol);

    deployer.deploy(MinHeap);
    deployer.link(MinHeap, MinHeapMock);
    deployer.link(MinHeap, TranscoderPools);

    deployer.deploy(MaxHeap);
    deployer.link(MaxHeap, MaxHeapMock);
    deployer.link(MaxHeap, TranscoderPools);

    deployer.deploy(TranscoderPools);
    deployer.link(TranscoderPools, TranscoderPoolsMock);

    deployer.deploy(ECVerify);
    deployer.link(ECVerify, LivepeerProtocol);

    deployer.deploy(MerkleProof);
    deployer.link(MerkleProof, LivepeerProtocol);

    deployer.deploy(LivepeerToken);
    deployer.link(LivepeerToken, LivepeerProtocol);
    deployer.link(TranscoderPools, LivepeerProtocol);
    deployer.deploy(LivepeerProtocol, 1, 50, 2);
};
