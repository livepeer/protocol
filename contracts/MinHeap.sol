pragma solidity ^0.4.8;

library MinHeap {
    uint private constant MAX_NODES = 100;

    struct Node {
        address value;
        uint key;
    }

    struct Heap {
        Node[100] nodes;
        uint size;
        uint maxSize;
    }

    function init(Heap storage self, uint size) {
        if (size > MAX_NODES) throw;
        if (size < self.maxSize) throw;

        self.maxSize = size;
    }

    function min(Heap storage self) constant returns (address, uint) {
        if (self.size == 0) throw;

        return (self.nodes[0].value, self.nodes[0].key);
    }

    function insert(Heap storage self, address _value, uint _key) {
        if (self.size == self.maxSize) throw;

        self.size++;
        self.nodes[self.size - 1] = Node(_value, _key);

        siftUp(self, self.size - 1);
    }

    function deleteMin(Heap storage self) {
        if (self.size == 0) throw;

        deletePos(self, 0);
    }

    function deletePos(Heap storage self, uint pos) {
        if (self.size < pos) throw;

        self.nodes[pos] = self.nodes[self.size - 1];
        delete self.nodes[self.size - 1];
        self.size--;

        siftDown(self, pos);
    }

    function siftUp(Heap storage self, uint pos) private {
        Node memory start = self.nodes[pos];

        while (pos != 0 && start.key < self.nodes[pos / 2].key) {
            self.nodes[pos] = self.nodes[pos / 2];
            pos = pos / 2;
        }

        self.nodes[pos] = start;
    }

    function siftDown(Heap storage self, uint pos) private {
        Node memory start = self.nodes[pos];

        bool isHeap = false;
        uint sibling = pos * 2;

        while (sibling <= self.size - 1 && !isHeap) {
            if (sibling != self.size - 1 && self.nodes[sibling + 1].key < self.nodes[sibling].key) {
                sibling++;
            }

            if (self.nodes[sibling].key < start.key) {
                self.nodes[pos] = self.nodes[sibling];
                pos = sibling;
                sibling = pos * 2;
            } else {
                isHeap = true;
            }
        }

        self.nodes[pos] = start;
    }
}
