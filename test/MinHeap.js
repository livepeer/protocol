const MinHeapMock = artifacts.require("./MinHeapMock.sol");

contract("MinHeap", function(accounts) {
    it("should initialize correctly", async function() {
        const minHeapMock = await MinHeapMock.new();

        await minHeapMock.init(10);

        const heap = await minHeapMock.heap.call();
        assert.equal(heap[1], 10, "heap did not initialize with correct size");
    });

    it("should insert correctly", async function() {
        const minHeapMock = await MinHeapMock.new();
        await minHeapMock.init(10);

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
        const minHeapMock = await MinHeapMock.new();
        await minHeapMock.init(10);

        await minHeapMock.insert(accounts[0], 5);
        await minHeapMock.insert(accounts[1], 3);
        await minHeapMock.insert(accounts[2], 1);

        await minHeapMock.deleteMin();

        let minNode = await minHeapMock.min();
        assert.equal(minNode[0], accounts[1], "heap did not delete and update new min value");
        assert.equal(minNode[1], 3, "heap did not delete and update new min key");
    });

    it("should increase key correctly", async function() {
        const minHeapMock = await MinHeapMock.new();
        await minHeapMock.init(10);

        await minHeapMock.insert(accounts[0], 5);
        await minHeapMock.insert(accounts[1], 3);
        await minHeapMock.insert(accounts[2], 1);

        await minHeapMock.increaseKey(accounts[2], 4);

        let minNode = await minHeapMock.min();
        assert.equal(minNode[0], accounts[1], "heap did not increase key and update new min value");
        assert.equal(minNode[1], 3, "heap did not increase key and update new min key");
    });

    it("should decrease key correctly", async function() {
        const minHeapMock = await MinHeapMock.new();
        await minHeapMock.init(10);

        await minHeapMock.insert(accounts[0], 5);
        await minHeapMock.insert(accounts[1], 3);
        await minHeapMock.insert(accounts[2], 2);

        await minHeapMock.decreaseKey(accounts[1], 1);

        let minNode = await minHeapMock.min();
        assert.equal(minNode[0], accounts[1], "heap did not decrease key and update new min value");
        assert.equal(minNode[1], 1, "heap did not decrease key and update new min key");
    });

    it("should check if it contains a value", async function() {
        const minHeapMock = await MinHeapMock.new();
        await minHeapMock.init(10);

        await minHeapMock.insert(accounts[0], 5);

        let containsValue = await minHeapMock.contains(accounts[0]);
        assert.ok(containsValue, "heap did not return true for a value it contains");

        containsValue = await minHeapMock.contains(accounts[1]);
        assert.isNotOk(containsValue, "heap did not return false for a value it does not contain");
    });
});
