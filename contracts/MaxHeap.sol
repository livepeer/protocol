pragma solidity ^0.4.8;

library MaxHeap {
    uint private constant HARD_MAX = 100;

    struct Node {
        address value;
        uint key;
    }

    struct Heap {
        Node[100] nodes;
        mapping (address => uint) positions;
        mapping (address => bool) values;
        uint size;
        uint maxSize;
    }

    /*
     * Initialize heap by setting a max size
     * @param _size Max size of heap
     */
    function init(Heap storage self, uint _size) {
        // Check if size is less than hard max
        if (_size > HARD_MAX) throw;
        // Check if there is already a max size
        if (self.maxSize > 0) throw;

        self.maxSize = _size;
    }

    /*
     * Checks if an address is in the heap
     * @param _vallue Address value
     */
    function contains(Heap storage self, address _value) constant returns (bool) {
        return self.values[_value];
    }

    /*
     * Returns the max node in the heap as a address, key pair
     */
    function max(Heap storage self) constant returns (address, uint) {
        if (self.size == 0) throw;

        return (self.nodes[0].value, self.nodes[0].key);
    }

    /*
     * Inserts an adress and key as a node in the heap
     * @param _value Address value
     * @param _key Key for address
     */
    function insert(Heap storage self, address _value, uint _key) {
        // Check if heap is already full
        if (self.size == self.maxSize) throw;

        // Update heap size
        self.size++;
        // Create and set node
        self.nodes[self.size - 1] = Node(_value, _key);
        // Update position of node
        self.positions[_value] = self.size - 1;
        // Update values contained in heap
        self.values[_value] = true;

        // Sift up to maintain heap property
        siftUp(self, self.size - 1);
    }

    /*
     * Extract the max node from the heap
     */
    function extractMax(Heap storage self) {
        // Check for empty heap
        if (self.size == 0) throw;

        deletePos(self, 0);
    }

    /*
     * Delete node at given position while maintaining heap property
     * @param _pos Position of node
     */
    function deletePos(Heap storage self, uint _pos) {
        if (self.size < _pos) throw;

        // Update values contained in the heap
        self.values[self.nodes[_pos].value] = false;

        // Set the last node of the heap to the current position
        self.nodes[_pos] = self.nodes[self.size - 1];
        // Update position of the former last node of the heap
        self.positions[self.nodes[_pos].value] = _pos;
        // Delete the last node of the heap
        delete self.nodes[self.size - 1];
        // Update heap size
        self.size--;

        // Sift down to maintain heap property
        siftDown(self, _pos);
    }

    /*
     * Increases key for address in the heap while maintaing heap property
     * @param _value Address value
     * @param _key Increased key for address
     */
    function increaseKey(Heap storage self, address _value, uint _key) {
        // Get position of address in heap
        uint pos = self.positions[_value];

        if (self.size < pos) throw;

        // Update key for address
        self.nodes[pos].key = _key;

        // Sift up to maintain heap property
        siftUp(self, pos);
    }

    /*
     * Decreases key for address in the heap while maintaing heap property
     * @param _value Address value
     * @param _key Decreased key for address
     */
    function decreaseKey(Heap storage self, address _value, uint _key) {
        // Get position of address in heap
        uint pos = self.positions[_value];

        if (self.size < pos) throw;

        // Update key for address
        self.nodes[pos].key = _key;

        // Sift down to maintain heap property
        siftDown(self, pos);
    }

    /*
     * Sifts a node up the heap to its proper position such that the heap property is obeyed
     * @param _pos Starting position of node
     */
    function siftUp(Heap storage self, uint _pos) private {
        // Set current node to be node at starting position
        Node memory curr = self.nodes[_pos];

        while (_pos > 0 && self.nodes[_pos / 2].key < curr.key) {
            // Set parent as child
            self.nodes[_pos] = self.nodes[_pos / 2];
            // Update position of parent
            self.positions[self.nodes[_pos].value] = _pos;
            // Set current position to be parent position
            _pos = _pos / 2;
        }

        // Set current node at its new position in the heap
        self.nodes[_pos] = curr;
        // Update position of current node
        self.positions[curr.value] = _pos;
    }

    /*
     * Sifts a node down the heap to its proper position such that the heap property is obeyed
     * @param _pos Starting position of node
     */
    function siftDown(Heap storage self, uint _pos) private {
        // Set current node to be node at starting position
        Node memory curr = self.nodes[_pos];
        // Flag for whether the heap property is obeyed
        bool isHeap = false;
        // Set index of current largest node to left child
        uint largest = _pos * 2;

        // Sift until we obey the heap property
        while (largest < self.size && !isHeap) {
            if (largest < self.size && self.nodes[largest + 1].key > self.nodes[largest].key) {
                // Update index of current smallest node to be right child
                largest++;
            }

            if (self.nodes[largest].key > curr.key) {
                // One of the children is the smallest node
                // Set the largest node as the new parent
                self.nodes[_pos] = self.nodes[largest];
                // Update position of child
                self.positions[self.nodes[_pos].value] = _pos;
                // Set current index to index of the largest node
                _pos = largest;
                // Set index of current largest node to left child of the node at the new current index
                largest = _pos * 2;
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
            self.positions[curr.value] = _pos;
        }
    }
}
