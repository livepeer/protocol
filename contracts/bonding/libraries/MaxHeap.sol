pragma solidity ^0.4.11;

import "./Node.sol";

import "../../../installed_contracts/zeppelin/contracts/SafeMath.sol";

library MaxHeap {
    using SafeMath for uint256;

    struct Heap {
        Node.Node[] nodes;
        mapping (address => uint) positions;
        mapping (address => bool) ids;
        uint maxSize;
        bool initialized;
    }

    /*
     * Initialize heap by setting a max size
     * @param _size Max size of heap
     */
    function init(Heap storage self, uint _size) {
        // Check if heap is already initialized
        if (self.initialized == true) throw;

        self.maxSize = _size;
        self.initialized = true;
    }

    /*
     * Checks if an address is in the heap
     * @param _id Address id
     */
    function contains(Heap storage self, address _id) constant returns (bool) {
        return self.ids[_id];
    }

    /*
     * Returns current size of heap
     */
    function size(Heap storage self) constant returns (uint256) {
        return self.nodes.length;
    }

    /*
     * Checks if heap is full
     */
    function isFull(Heap storage self) constant returns (bool) {
        return self.nodes.length == self.maxSize;
    }

    /*
     * Checks if heap is empty
     */
    function isEmpty(Heap storage self) constant returns (bool) {
        return self.nodes.length == 0;
    }

    /*
     * Returns key for an id
     * @param Address id
     */
    function getKey(Heap storage self, address _id) constant returns (uint256) {
        // Check if id is in heap
        if (self.ids[_id] == false) throw;

        return self.nodes[self.positions[_id]].key;
    }

    /*
     * Returns the max node in the heap as a address, key pair
     */
    function max(Heap storage self) constant returns (address, uint) {
        // Check if heap is empty
        if (self.nodes.length == 0) throw;

        return (self.nodes[0].id, self.nodes[0].key);
    }

    /*
     * Inserts an address and key as a node in the heap
     * @param _id Address id
     * @param _key Key for id
     */
    function insert(Heap storage self, address _id, uint _key) {
        // Check if heap is already full
        if (self.nodes.length == self.maxSize) throw;
        // Check if id already in heap
        if (self.ids[_id] == true) throw;

        // Create and set node
        self.nodes.push(Node.Node(_id, _key, true));
        // Update position of node
        self.positions[_id] = self.nodes.length - 1;
        // Update ids contained in heap
        self.ids[_id] = true;

        // Sift up to maintain heap property
        siftUp(self, self.nodes.length - 1);
    }

    /*
     * Extract the max node from the heap
     */
    function extractMax(Heap storage self) {
        // Check for empty heap
        if (self.nodes.length == 0) throw;

        deletePos(self, 0);
    }

    /*
     * Delete node with id from heap
     * @param _id Address id
     */
    function deleteId(Heap storage self, address _id) {
        // Check if id is in heap
        if (self.ids[_id] == false) throw;

        deletePos(self, self.positions[_id]);
    }

    /*
     * Delete node at given position while maintaining heap property
     * @param _pos Position of node
     */
    function deletePos(Heap storage self, uint _pos) {
        if (self.nodes.length < _pos) throw;

        // Update ids contained in the heap
        self.ids[self.nodes[_pos].id] = false;

        // Set the last node of the heap to the current position
        self.nodes[_pos] = self.nodes[self.nodes.length - 1];
        // Update position of the former last node of the heap
        self.positions[self.nodes[_pos].id] = _pos;
        // Delete the last node of the heap
        delete self.nodes[self.nodes.length - 1];
        // Update heap size
        self.nodes.length--;

        if (self.nodes.length > _pos) {
            // Sift down to maintain heap property
            siftDown(self, _pos);
        }
    }

    /*
     * Increases key for address in the heap while maintaing heap property
     * @param _id Address id
     * @param _amount Amount to increase key by
     */
    function increaseKey(Heap storage self, address _id, uint _amount) {
        // Check if id in heap
        if (self.ids[_id] == false) throw;

        uint pos = self.positions[_id];

        // Update key for address
        self.nodes[pos].key = self.nodes[pos].key.add(_amount);

        // Sift up to maintain heap property
        siftUp(self, pos);
    }

    /*
     * Decreases key for address in the heap while maintaing heap property
     * @param _id Address id
     * @param _amount Amount to decrease key by
     */
    function decreaseKey(Heap storage self, address _id, uint _amount) {
        // Check if id in heap
        if (self.ids[_id] == false) throw;

        uint pos = self.positions[_id];

        // Update key for address
        self.nodes[pos].key = self.nodes[pos].key.sub(_amount);

        // Sift down to maintain heap property
        siftDown(self, pos);
    }

    /*
     * Sifts a node up the heap to its proper position such that the heap property is obeyed
     * @param _pos Starting position of node
     */
    function siftUp(Heap storage self, uint _pos) private {
        // Set current node to be node at starting position
        Node.Node memory curr = self.nodes[_pos];

        while (_pos > 0 && self.nodes[(_pos - 1) / 2].key < curr.key) {
            // Set parent as child
            self.nodes[_pos] = self.nodes[(_pos - 1) / 2];
            // Update position of parent
            self.positions[self.nodes[_pos].id] = _pos;
            // Set current position to be parent position
            _pos = (_pos - 1) / 2;
        }

        // Set current node at its new position in the heap
        self.nodes[_pos] = curr;
        // Update position of current node
        self.positions[curr.id] = _pos;
    }

    /*
     * Sifts a node down the heap to its proper position such that the heap property is obeyed
     * @param _pos Starting position of node
     */
    function siftDown(Heap storage self, uint _pos) private {
        // Set current node to be node at starting position
        Node.Node memory curr = self.nodes[_pos];
        // Flag for whether the heap property is obeyed
        bool isHeap = false;
        // Set index of current largest node to left child
        uint largest = _pos * 2 + 1;

        // Sift until we obey the heap property
        while (largest < self.nodes.length && !isHeap) {
            if (largest + 1 < self.nodes.length
                && self.nodes[largest + 1].key > self.nodes[largest].key) {
                // Update index of current smallest node to be right child
                largest++;
            }

            if (self.nodes[largest].key > curr.key) {
                // One of the children is the smallest node
                // Set the largest node as the new parent
                self.nodes[_pos] = self.nodes[largest];
                // Update position of child
                self.positions[self.nodes[_pos].id] = _pos;
                // Set current index to index of the largest node
                _pos = largest;
                // Set index of current largest node to left child of the node at the new current index
                largest = _pos * 2 + 1;
            } else {
                // If the current largest node is already less than the starting node we are done
                isHeap = true;
            }

            // If we swapped:
            // We set the former parent as the child of the new parent
            // Else:
            // This line just sets the current node at its original position
            self.nodes[_pos] = curr;
            // Update position of current node
            self.positions[curr.id] = _pos;
        }
    }
}
