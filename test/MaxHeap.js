const MaxHeapMock = artifacts.require("./MaxHeapMock.sol");

contract("MaxHeap", function(accounts) {
    it("should initialize correctly", async function() {
        const maxHeapMock = await MaxHeapMock.new();

        await maxHeapMock.init(10);

        const heap = await maxHeapMock.heap.call();
        assert.equal(heap[1], 10, "heap did not initialize with correct size");
    });

    it("should insert correctly", async function() {
        const maxHeapMock = await MaxHeapMock.new();
        await maxHeapMock.init(10);

        // Insert with key = 3
        await maxHeapMock.insert(accounts[0], 3);

        let currHeap = await maxHeapMock.heap.call();
        assert.equal(currHeap[0], 1, "heap did not update size correctly after inserting 1 node");

        let maxNode = await maxHeapMock.max();
        assert.equal(maxNode[0], accounts[0], "heap did not update value correctly after inserting 1 node");
        assert.equal(maxNode[1], 3, "heap did not update key correctly after inserting 1 node");

        // Insert with key = 5
        await maxHeapMock.insert(accounts[1], 5);

        currHeap = await maxHeapMock.heap.call();
        assert.equal(currHeap[0], 2, "heap did not update size correctly after inserting 2 nodes");

        maxNode = await maxHeapMock.max();
        assert.equal(maxNode[0], accounts[1], "heap did not update value correctly after inserting 2 nodes");
        assert.equal(maxNode[1], 5, "heap did not update key correctly after inserting 2 nodes");

        // Insert with key = 4
        await maxHeapMock.insert(accounts[2], 4);

        currHeap = await maxHeapMock.heap.call();
        assert.equal(currHeap[0], 3, "heap did not update size correctly after inserting 3 nodes");

        maxNode = await maxHeapMock.max();
        assert.equal(maxNode[0], accounts[1], "heap did not update value correctly after inserting 3 nodes");
        assert.equal(maxNode[1], 5, "heap did not update key correctly after inserting 3 nodes");

        // Insert with key = 6
        await maxHeapMock.insert(accounts[3], 6);

        currHeap = await maxHeapMock.heap.call();
        assert.equal(currHeap[0], 4, "heap did not update size correctly after inserting 4 nodes");

        maxNode = await maxHeapMock.max();
        assert.equal(maxNode[0], accounts[3], "heap did not update value correctly after inserting 4 nodes");
        assert.equal(maxNode[1], 6, "heap did not update key correctly after inserting 4 nodes");
    });

    it("should fail to insert for existing id", async function() {
        const maxHeapMock = await MaxHeapMock.new();
        await maxHeapMock.init(10);

        // Insert with key = 5
        await maxHeapMock.insert(accounts[0], 5);

        let threw = false;

        try {
            await maxHeapMock.insert(accounts[0], 3);
        } catch (err) {
            threw = true;
        }

        assert.isOk(threw, "heap did not throw for existing id");
    });

    it("should get key correctly", async function() {
        const maxHeapMock = await MaxHeapMock.new();
        await maxHeapMock.init(10);

        // Insert with key = 5
        await maxHeapMock.insert(accounts[0], 5);

        const key = await maxHeapMock.getKey(accounts[0]);
        assert.equal(key, 5, "heap did not get key correctly");
    });

    it("should fail to get key for non-existent id", async function() {
        const maxHeapMock = await MaxHeapMock.new();
        await maxHeapMock.init(10);

        // Insert with key = 5
        await maxHeapMock.insert(accounts[0], 5);

        let threw;

        try {
            await maxHeapMock.getKey(accounts[1]);
        } catch (err) {
            threw = true;
        }

        assert.isOk(threw, "heap did not fail to get key for non-existent id");
    });

    it("should extract max correctly", async function() {
        const maxHeapMock = await MaxHeapMock.new();
        await maxHeapMock.init(10);

        await maxHeapMock.insert(accounts[0], 1);
        await maxHeapMock.insert(accounts[1], 3);
        await maxHeapMock.insert(accounts[2], 5);

        // Extract max
        await maxHeapMock.extractMax();

        let currHeap = await maxHeapMock.heap.call();
        assert.equal(currHeap[0], 2, "heap did not update size correctly after first extract max");

        let maxNode = await maxHeapMock.max();
        assert.equal(maxNode[0], accounts[1], "heap did not update new max value after first extract max correctly");
        assert.equal(maxNode[1], 3, "heap did not update new max key after first extract max correctly");

        // Extract max
        await maxHeapMock.extractMax();

        currHeap = await maxHeapMock.heap.call();
        assert.equal(currHeap[0], 1, "heap did not update size correctly after second extract max");

        maxNode = await maxHeapMock.max();
        assert.equal(maxNode[0], accounts[0], "heap did not update new max value after second extract max correctly");
        assert.equal(maxNode[1], 1, "heap did not update new max key after second extract max correctly");

        // Extract max
        await maxHeapMock.extractMax();

        currHeap = await maxHeapMock.heap.call();
        assert.equal(currHeap[0], 0, "heap did not update size correctly after third extract max");
    });

    it("should increase key correctly", async function() {
        const maxHeapMock = await MaxHeapMock.new();
        await maxHeapMock.init(10);

        await maxHeapMock.insert(accounts[0], 1);
        await maxHeapMock.insert(accounts[1], 3);
        await maxHeapMock.insert(accounts[2], 5);

        await maxHeapMock.increaseKey(accounts[1], 3);

        let maxNode = await maxHeapMock.max();
        assert.equal(maxNode[0], accounts[1], "heap did not increase key and update new max value");
        assert.equal(maxNode[1], 6, "heap did not increase key and update new max key");
    });

    it("should fail to increase key for non-existent id", async function() {
        const maxHeapMock = await MaxHeapMock.new();
        await maxHeapMock.init(10);

        await maxHeapMock.insert(accounts[0], 5);

        let threw = false;

        try {
            await maxHeapMock.increaseKey(accounts[1], 2);
        } catch (err) {
            threw = true;
        }

        assert.isOk(threw, "heap did not throw for non-existent id");
    });

    it("should decrease key correctly", async function() {
        const maxHeapMock = await MaxHeapMock.new();
        await maxHeapMock.init(10);

        await maxHeapMock.insert(accounts[0], 2);
        await maxHeapMock.insert(accounts[1], 3);
        await maxHeapMock.insert(accounts[2], 5);

        await maxHeapMock.decreaseKey(accounts[2], 4);

        let maxNode = await maxHeapMock.max();
        assert.equal(maxNode[0], accounts[1], "heap did not decrease key and update new max value");
        assert.equal(maxNode[1], 3, "heap did not decrease key and update new max key");
    });

    it("should fail to decrease key for non-existent id", async function() {
        const maxHeapMock = await MaxHeapMock.new();
        await maxHeapMock.init(10);

        await maxHeapMock.insert(accounts[0], 5);

        let threw = false;

        try {
            await maxHeapMock.decreaseKey(accounts[1], 2);
        } catch (err) {
            threw = true;
        }

        assert.isOk(threw, "heap did not throw for a non-existent id");
    });

    it("should check if it contains a value", async function() {
        const maxHeapMock = await MaxHeapMock.new();
        await maxHeapMock.init(10);

        let containsValue = await maxHeapMock.contains(accounts[0]);
        assert.isNotOk(containsValue, "heap did not return false for a value it does not contain after initialization");

        await maxHeapMock.insert(accounts[0], 5);

        containsValue = await maxHeapMock.contains(accounts[0]);
        assert.ok(containsValue, "heap did not return true for a value it contains");

        containsValue = await maxHeapMock.contains(accounts[1]);
        assert.isNotOk(containsValue, "heap did not return false for a value it does not contain");
    });
});
