pragma solidity ^0.4.8;

library MinHeap {
    uint private constant MAX_NODES = 100;

    struct Node {
        address value;
        uint key;
    }

    struct Heap {
        Node[100] nodes;
        mapping (address => uint) indicies;
        mapping (address => bool) values;
        uint size;
        uint maxSize;
    }

    function init(Heap storage self, uint _size) {
        if (_size > MAX_NODES) throw;
        if (_size < self.maxSize) throw;

        self.maxSize = _size;
    }

    function contains(Heap storage self, address _value) constant returns (bool) {
        return self.values[_value];
    }

    function min(Heap storage self) constant returns (address, uint) {
        if (self.size == 0) throw;

        return (self.nodes[0].value, self.nodes[0].key);
    }

    function insert(Heap storage self, address _value, uint _key) {
        if (self.size == self.maxSize) throw;

        self.size++;
        self.nodes[self.size - 1] = Node(_value, _key);
        self.indicies[_value] = self.size - 1;
        self.values[_value] = true;

        siftUp(self, self.size - 1);
    }

    function deleteMin(Heap storage self) {
        if (self.size == 0) throw;

        deletePos(self, 0);
    }

    function deletePos(Heap storage self, uint _pos) {
        if (self.size < _pos) throw;

        self.values[self.nodes[_pos].value] = false;

        self.nodes[_pos] = self.nodes[self.size - 1];
        self.indicies[self.nodes[_pos].value] = _pos;
        delete self.nodes[self.size - 1];
        self.size--;

        siftDown(self, _pos);
    }

    function increaseKey(Heap storage self, address _value, uint _key) {
        uint pos = self.indicies[_value];

        if (self.size < pos) throw;

        self.nodes[pos].key = _key;

        siftDown(self, pos);
    }

    function decreaseKey(Heap storage self, address _value, uint _key) {
        uint pos = self.indicies[_value];

        if (self.size < pos) throw;

        self.nodes[pos].key = _key;

        siftUp(self, pos);
    }

    function siftUp(Heap storage self, uint _pos) private {
        Node memory start = self.nodes[_pos];

        while (_pos != 0 && start.key < self.nodes[_pos / 2].key) {
            self.nodes[_pos] = self.nodes[_pos / 2];
            self.indicies[self.nodes[_pos].value] = _pos;
            _pos = _pos / 2;
        }

        self.nodes[_pos] = start;
        self.indicies[self.nodes[_pos].value] = _pos;
    }

    function siftDown(Heap storage self, uint _pos) private {
        Node memory start = self.nodes[_pos];

        bool isHeap = false;
        uint sibling = _pos * 2;

        while (sibling <= self.size - 1 && !isHeap) {
            if (sibling != self.size - 1 && self.nodes[sibling + 1].key < self.nodes[sibling].key) {
                sibling++;
            }

            if (self.nodes[sibling].key < start.key) {
                self.nodes[_pos] = self.nodes[sibling];
                self.indicies[self.nodes[_pos].value] = _pos;
                _pos = sibling;
                sibling = _pos * 2;
            } else {
                isHeap = true;
            }
        }

        self.nodes[_pos] = start;
        self.indicies[self.nodes[_pos].value] = _pos;
    }
}
