const MinHeapMock = artifacts.require("./MinHeapMock.sol");

contract("MinHeap", function(accounts) {
    let minHeapMock;

    before(async function() {
        minHeapMock = await MinHeapMock.new();
    });

    it("should initialize correctly", async function() {
        await minHeapMock.init(10);

        const heap = await minHeapMock.heap.call();
        assert.equal(heap[1], 10, "heap did not initialize with correct size");
    });

    it("should insert correctly", async function() {
        await minHeapMock.insert(accounts[0], 5);

        let currHeap = await minHeapMock.heap.call();
        assert.equal(currHeap[0], 1, "heap did not update size for node 1 correctly");

        let minNode = await minHeapMock.min();
        assert.equal(minNode[0], accounts[0], "heap did not insert value for node 1 correctly");
        assert.equal(minNode[1], 5, "heap did not insert key for node 1 correctly");

        await minHeapMock.insert(accounts[1], 3);

        currHeap = await minHeapMock.heap.call();
        assert.equal(currHeap[0], 2, "heap did not update size for node 2 correctly");

        minNode = await minHeapMock.min();
        assert.equal(minNode[0], accounts[1], "heap did not insert value for node 2 correctly");
        assert.equal(minNode[1], 3, "heap did not insert key for node 2 correctly");
    });

    it("should delete correctly", async function() {
        await minHeapMock.insert(accounts[0], 5);
        await minHeapMock.insert(accounts[1], 3);
        await minHeapMock.insert(accounts[2], 1);

        await minHeapMock.deleteMin();

        let minNode = await minHeapMock.min();
        assert.equal(minNode[0], accounts[1], "heap did not delete and update new min value");
        assert.equal(minNode[1], 3, "heap did not delete and update new min key");
    });
});
