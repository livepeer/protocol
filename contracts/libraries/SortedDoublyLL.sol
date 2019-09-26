pragma solidity ^0.5.11;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";


/*
 * @title A sorted doubly linked list with nodes sorted in descending order. Optionally accepts insert position hints
 *
 * Given a new node with a `key`, a hint is of the form `(prevId, nextId)` s.t. `prevId` and `nextId` are adjacent in the list.
 * `prevId` is a node with a key >= `key` and `nextId` is a node with a key <= `key`. If the sender provides a hint that is a valid insert position
 * the insert operation is a constant time storage write. However, the provided hint in a given transaction might be a valid insert position, but if other transactions are included first, when
 * the given transaction is executed the provided hint may no longer be a valid insert position. For example, one of the nodes referenced might be removed or their keys may
 * be updated such that the the pair of nodes in the hint no longer represent a valid insert position. If one of the nodes in the hint becomes invalid, we still try to use the other
 * valid node as a starting point for finding the appropriate insert position. If both nodes in the hint become invalid, we use the head of the list as a starting point
 * to find the appropriate insert position.
 */
library SortedDoublyLL {
    using SafeMath for uint256;

    // Information for a node in the list
    struct Node {
        uint256 key;                     // Node's key used for sorting
        address nextId;                  // Id of next node (smaller key) in the list
        address prevId;                  // Id of previous node (larger key) in the list
    }

    // Information for the list
    struct Data {
        address head;                        // Head of the list. Also the node in the list with the largest key
        address tail;                        // Tail of the list. Also the node in the list with the smallest key
        uint256 maxSize;                     // Maximum size of the list
        uint256 size;                        // Current size of the list
        mapping (address => Node) nodes;     // Track the corresponding ids for each node in the list
    }

    /*
     * @dev Set the maximum size of the list
     * @param _size Maximum size
     */
    function setMaxSize(Data storage self, uint256 _size) public {
        // New max size must be greater than old max size
        require(_size > self.maxSize);

        self.maxSize = _size;
    }

    /*
     * @dev Add a node to the list
     * @param _id Node's id
     * @param _key Node's key
     */
    function insert(Data storage self, address _id, uint256 _key) public {
        // List must not be full
        require(!isFull(self));
        // List must not already contain node
        require(!contains(self, _id));
        // Node id must not be null
        require(_id != address(0));
        // Key must be non-zero
        require(_key > 0);

        self.nodes[_id].key = _key;

        if (self.head == address(0) && self.tail == address(0)) {
            // Insert first node in the list
            self.head = _id;
            self.tail = _id;
        } else {
            // Insert after current tail
            self.nodes[self.tail].nextId = _id;
            self.nodes[_id].prevId = self.tail;
            self.tail = _id;
        }

        self.size = self.size.add(1);
    }

    /*
     * @dev Remove a node from the list
     * @param _id Node's id
     */
    function remove(Data storage self, address _id) public {
        // List must contain the node
        require(contains(self, _id));

        if (self.size > 1) {
            // List contains more than a single node
            if (_id == self.head) {
                // The removed node is the head
                // Set head to next node
                self.head = self.nodes[_id].nextId;
                // Set prev pointer of new head to null
                self.nodes[self.head].prevId = address(0);
            } else if (_id == self.tail) {
                // The removed node is the tail
                // Set tail to previous node
                self.tail = self.nodes[_id].prevId;
                // Set next pointer of new tail to null
                self.nodes[self.tail].nextId = address(0);
            } else {
                // The removed node is neither the head nor the tail
                // Set next pointer of previous node to the next node
                self.nodes[self.nodes[_id].prevId].nextId = self.nodes[_id].nextId;
                // Set prev pointer of next node to the previous node
                self.nodes[self.nodes[_id].nextId].prevId = self.nodes[_id].prevId;
            }
        } else {
            // List contains a single node
            // Set the head and tail to null
            self.head = address(0);
            self.tail = address(0);
        }

        delete self.nodes[_id];
        self.size = self.size.sub(1);
    }

    /*
     * @dev Update the key of a node in the list
     * @param _id Node's id
     * @param _newKey Node's new key
     */
    function updateKey(Data storage self, address _id, uint256 _newKey) public {
        // List must contain the node
        require(contains(self, _id));

        self.nodes[_id].key = _newKey;
    }

    /*
     * @dev Checks if the list contains a node
     * @param _transcoder Address of transcoder
     */
    function contains(Data storage self, address _id) public view returns (bool) {
        // List only contains non-zero keys, so if key is non-zero the node exists
        return self.nodes[_id].key > 0;
    }

    /*
     * @dev Checks if the list is full
     */
    function isFull(Data storage self) public view returns (bool) {
        return self.size == self.maxSize;
    }

    /*
     * @dev Checks if the list is empty
     */
    function isEmpty(Data storage self) public view returns (bool) {
        return self.size == 0;
    }

    /*
     * @dev Returns the current size of the list
     */
    function getSize(Data storage self) public view returns (uint256) {
        return self.size;
    }

    /*
     * @dev Returns the maximum size of the list
     */
    function getMaxSize(Data storage self) public view returns (uint256) {
        return self.maxSize;
    }

    /*
     * @dev Returns the key of a node in the list
     * @param _id Node's id
     */
    function getKey(Data storage self, address _id) public view returns (uint256) {
        return self.nodes[_id].key;
    }

    /*
     * @dev Returns the first node in the list (node with the largest key)
     */
    function getFirst(Data storage self) public view returns (address) {
        return self.head;
    }

    /*
     * @dev Returns the last node in the list (node with the smallest key)
     */
    function getLast(Data storage self) public view returns (address) {
        return self.tail;
    }

    /*
     * @dev Returns the next node (with a smaller key) in the list for a given node
     * @param _id Node's id
     */
    function getNext(Data storage self, address _id) public view returns (address) {
        return self.nodes[_id].nextId;
    }

    /*
     * @dev Returns the previous node (with a larger key) in the list for a given node
     * @param _id Node's id
     */
    function getPrev(Data storage self, address _id) public view returns (address) {
        return self.nodes[_id].prevId;
    }

    /**
     * @dev Returns the id and key of the node in the list with the smallest key
    */
    function findMin(Data storage self) public view returns (address, uint256) {
        address minId = self.head;
        uint256 minKey = self.nodes[minId].key;

        address currId = minId;

        // Descend the list and keep track of the node with the smallest key
        while (currId != address(0)) {
            uint256 currKey = self.nodes[currId].key;
            if (currKey < minKey) {
                minId = currId;
                minKey = currKey;
            }

            currId = self.nodes[currId].nextId;
        }

        return (minId, minKey);
    }
}
