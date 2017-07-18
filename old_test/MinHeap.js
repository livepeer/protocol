const MinHeapMock = artifacts.require("./MinHeapMock.sol");

contract("MinHeap", function(accounts) {
    it("should initialize correctly", async function() {
        const minHeapMock = await MinHeapMock.new();

        await minHeapMock.init(10);

        const heap = await minHeapMock.heap.call();
        assert.equal(heap[0], 10, "heap did not initialize with correct size");
    });

    it("should insert correctly", async function() {
        const minHeapMock = await MinHeapMock.new();
        await minHeapMock.init(10);

        // Insert with key = 5
        await minHeapMock.insert(accounts[0], 5);

        let heapSize = await minHeapMock.size();
        assert.equal(heapSize, 1, "heap did not update size correctly after inserting 1 node");

        let minNode = await minHeapMock.min();
        assert.equal(minNode[0], accounts[0], "heap did not update value correctly after inserting 1 node");
        assert.equal(minNode[1], 5, "heap did not update key correctly after inserting 1 node");

        // Insert with key = 3
        await minHeapMock.insert(accounts[1], 3);

        heapSize = await minHeapMock.size();
        assert.equal(heapSize, 2, "heap did not update size correctly after inserting 2 nodes");

        minNode = await minHeapMock.min();
        assert.equal(minNode[0], accounts[1], "heap did not update value correctly after inserting 2 nodes");
        assert.equal(minNode[1], 3, "heap did not update key correctly after inserting 2 nodes");

        // Insert with key = 4
        await minHeapMock.insert(accounts[2], 4);

        heapSize = await minHeapMock.size();
        assert.equal(heapSize, 3, "heap did not update size correctly after inserting 3 nodes");

        minNode = await minHeapMock.min();
        assert.equal(minNode[0], accounts[1], "heap did not update value correctly after inserting 3 nodes");
        assert.equal(minNode[1], 3, "heap did not update key correctly after inserting 3 nodes");

        // Insert with key = 1
        await minHeapMock.insert(accounts[3], 1);

        heapSize = await minHeapMock.size();
        assert.equal(heapSize, 4, "heap did not update size correctly after inserting 4 nodes");

        minNode = await minHeapMock.min();
        assert.equal(minNode[0], accounts[3], "heap did not update value correctly after inserting 4 nodes");
        assert.equal(minNode[1], 1, "heap did not update key correctly after inserting 4 nodes");
    });

    it("should fail to insert for existing id", async function() {
        const minHeapMock = await MinHeapMock.new();
        await minHeapMock.init(10);

        // Insert with key = 5
        await minHeapMock.insert(accounts[0], 5);

        let threw = false;

        try {
            await minHeapMock.insert(accounts[0], 3);
        } catch (err) {
            threw = true;
        }

        assert.isOk(threw, "heap did not throw for existing id");
    });

    it("should get key correctly", async function() {
        const minHeapMock = await MinHeapMock.new();
        await minHeapMock.init(10);

        // Insert with key = 5
        await minHeapMock.insert(accounts[0], 5);

        const key = await minHeapMock.getKey(accounts[0]);
        assert.equal(key, 5, "heap did not get key correctly");

    });

    it("should fail to get key for non-existent id", async function() {
        const minHeapMock = await MinHeapMock.new();
        await minHeapMock.init(10);

        // Insert with key = 5
        await minHeapMock.insert(accounts[0], 5);

        let threw = false;

        try {
            await minHeapMock.getKey(accounts[1]);
        } catch (err) {
            threw = true;
        }

        assert.isOk(threw, "heap did not fail to get key for non-existent id");
    });

    it("should extract min correctly", async function() {
        const minHeapMock = await MinHeapMock.new();
        await minHeapMock.init(10);

        await minHeapMock.insert(accounts[0], 5);
        await minHeapMock.insert(accounts[1], 3);
        await minHeapMock.insert(accounts[2], 1);

        // Extract min
        await minHeapMock.extractMin();

        let heapSize = await minHeapMock.size();
        assert.equal(heapSize, 2, "heap did not update size correctly after first extract min");

        let minNode = await minHeapMock.min();
        assert.equal(minNode[0], accounts[1], "heap did not update new min value after first extract min correctly");
        assert.equal(minNode[1], 3, "heap did not update new min key after first extract min correctly");

        // Extract min
        await minHeapMock.extractMin();

        heapSize = await minHeapMock.size();
        assert.equal(heapSize, 1, "heap did not update size correctly after second extract min");

        minNode = await minHeapMock.min();
        assert.equal(minNode[0], accounts[0], "heap did not update new min value after second extract min correctly");
        assert.equal(minNode[1], 5, "heap did not update new min key after second extract min correctly");

        // Extract min
        await minHeapMock.extractMin();

        heapSize = await minHeapMock.size();
        assert.equal(heapSize, 0, "heap did not update size correctly after third extract min");
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

    it("should fail to increase key for non-existent id", async function() {
        const minHeapMock = await MinHeapMock.new();
        await minHeapMock.init(10);

        await minHeapMock.insert(accounts[0], 5);

        let threw = false;

        try {
            await minHeapMock.increaseKey(accounts[1], 2);
        } catch (err) {
            threw = true;
        }

        assert.isOk(threw, "heap did not throw for non-existent id");
    });

    it("should delete an id correctly", async function() {
        const minHeapMock = await MinHeapMock.new();
        await minHeapMock.init(10);

        await minHeapMock.insert(accounts[0], 2);
        await minHeapMock.insert(accounts[1], 3);
        await minHeapMock.insert(accounts[2], 5);

        await minHeapMock.deleteId(accounts[1]);

        const heapSize = await minHeapMock.size();
        assert.equal(heapSize, 2, "heap did not update size correctly after delete id");
    });

    it("should decrease key correctly", async function() {
        const minHeapMock = await MinHeapMock.new();
        await minHeapMock.init(10);

        await minHeapMock.insert(accounts[0], 5);
        await minHeapMock.insert(accounts[1], 3);
        await minHeapMock.insert(accounts[2], 2);

        // Decrease key by 2
        await minHeapMock.decreaseKey(accounts[1], 2);

        let minNode = await minHeapMock.min();
        assert.equal(minNode[0], accounts[1], "heap did not decrease key and update new min value");
        assert.equal(minNode[1], 1, "heap did not decrease key and update new min key");
    });

    it("should fail to decrease key for non-existent id", async function() {
        const minHeapMock = await MinHeapMock.new();
        await minHeapMock.init(10);

        await minHeapMock.insert(accounts[0], 5);

        let threw = false;

        try {
            await minHeapMock.decreaseKey(accounts[1], 2);
        } catch (err) {
            threw = true;
        }

        assert.isOk(threw, "heap did not throw for a non-existent id");
    });

    it("should check if it contains a value", async function() {
        const minHeapMock = await MinHeapMock.new();
        await minHeapMock.init(10);

        let containsValue = await minHeapMock.contains(accounts[0]);
        assert.isNotOk(containsValue, "heap did not return false for a value it does not contain after initialization");

        await minHeapMock.insert(accounts[0], 5);

        containsValue = await minHeapMock.contains(accounts[0]);
        assert.ok(containsValue, "heap did not return true for a value it contains");

        containsValue = await minHeapMock.contains(accounts[1]);
        assert.isNotOk(containsValue, "heap did not return false for a value it does not contain");
    });

    it("should check if it is full", async function() {
        const minHeapMock = await MinHeapMock.new();
        await minHeapMock.init(2);

        await minHeapMock.insert(accounts[0], 5);
        await minHeapMock.insert(accounts[1], 6);

        const isFull = await minHeapMock.isFull();
        assert.isOk(isFull, "is full did not return true for full heap");
    });
});
