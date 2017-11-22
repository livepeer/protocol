pragma solidity ^0.4.17;

import "zeppelin-solidity/contracts/math/SafeMath.sol";


/*
 * @title A pool of registered transcoders and their stakes implemented as a sorted doubly linked list
 */
library TranscoderPool {
    using SafeMath for uint256;

    // Represents a transcoder in the list
    struct Node {
        uint256 stake;                   // Stake for the transcoder represented by this node
        address nextTranscoder;          // Address of next transcoder in the list
        address prevTranscoder;          // Address of previous transcoder in the list
    }

    // Represents a sorted doubly linked list
    struct Data {
        address head;                        // Head of the list. Also the transcoder in the list with the least stake
        address tail;                        // Tail of the list. Also the transcoder in the list with the most stake
        uint256 maxSize;                     // Maximum size of the list
        uint256 size;                        // Current size of the list
        mapping (address => Node) nodes;     // Track the corresponding transcoder address for each node in the list
    }

    /*
     * @dev Set the maximum size of the list
     * @param _size Maximum size
     */
    function setMaxSize(Data storage self, uint256 _size) public {
        self.maxSize = _size;
    }

    /*
     * @dev Add a transcoder to the list. Optionally accepts a hint for where to insert the new transcoder in the form of (_worseTranscoder, _betterTranscoder)
     * @param _transcoder Address of transcoder
     * @param _stake Transcoder's stake
     * @param _worseTranscoder Address of transcoder with less stake than the new transcoder
     * @param _betterTranscoder Address of transcoder with more stake than the new transcoder
     */
    function addTranscoder(Data storage self, address _transcoder, uint256 _stake, address _worseTranscoder, address _betterTranscoder) public {
        // List must not be full
        require(!isFull(self));
        // List must not already contain the transcoder
        require(!contains(self, _transcoder));
        // Transcoder address must not be null
        require(_transcoder != address(0));
        // Stake must be non-zero
        require(_stake > 0);

        address worseTranscoder = _worseTranscoder;
        address betterTranscoder = _betterTranscoder;

        if (!correctBoundingTranscoders(self, _stake, _worseTranscoder, _betterTranscoder)) {
            (worseTranscoder, betterTranscoder) = findBoundingTranscoders(self, _stake, _worseTranscoder, _betterTranscoder);
        }

        self.nodes[_transcoder].stake = _stake;

        if (worseTranscoder == address(0) && betterTranscoder == address(0)) {
            // Insert as head and tail
            self.head = _transcoder;
            self.tail = _transcoder;
        } else if (worseTranscoder == address(0)) {
            // Insert as head
            self.nodes[_transcoder].nextTranscoder = self.head;
            self.nodes[self.head].prevTranscoder = _transcoder;
            self.head = _transcoder;
        } else if (betterTranscoder == address(0)) {
            // Insert as tail
            self.nodes[_transcoder].prevTranscoder = self.tail;
            self.nodes[self.tail].nextTranscoder = _transcoder;
            self.tail = _transcoder;
        } else {
            // Insert in between bounding transcoders
            self.nodes[_transcoder].nextTranscoder = betterTranscoder;
            self.nodes[_transcoder].prevTranscoder = worseTranscoder;
            self.nodes[worseTranscoder].nextTranscoder = _transcoder;
            self.nodes[betterTranscoder].prevTranscoder = _transcoder;
        }

        self.size++;
    }

    /*
     * @dev Remove a transcoder from the list
     * @param _transcoder Address of transcoder
     */
    function removeTranscoder(Data storage self, address _transcoder) public {
        // List must contain the transcoder
        require(contains(self, _transcoder));

        if (self.size > 1) {
            // List contains more than a single node
            if (_transcoder == self.head) {
                // The removed node is the head
                // Set head to next node
                self.head = self.nodes[_transcoder].nextTranscoder;
                // Set prev pointer of new head to null
                self.nodes[self.head].prevTranscoder = address(0);
            } else if (_transcoder == self.tail) {
                // The removed node is the tail
                // Set tail to previous node
                self.tail = self.nodes[_transcoder].prevTranscoder;
                // Set next pointer of new tail to null
                self.nodes[self.tail].nextTranscoder = address(0);
            } else {
                // The removed node is neither the head nor the tail
                // Set next pointer of previous node to the next node
                self.nodes[self.nodes[_transcoder].prevTranscoder].nextTranscoder = self.nodes[_transcoder].nextTranscoder;
                // Set prev pointer of next node to the previous node
                self.nodes[self.nodes[_transcoder].nextTranscoder].prevTranscoder = self.nodes[_transcoder].prevTranscoder;
            }
        } else {
            // List contains a single node
            // Set the head and tail to null
            self.head = address(0);
            self.tail = address(0);
        }

        delete self.nodes[_transcoder];
        self.size--;
    }

    /*
     * @dev Increase the stake of a transcoder in the list
     * @param _transcoder Address of transcoder
     * @param _amount Amount to increase transcoder's stake by
     * @param _worseTranscoder Address of a transcoder with less stake than the updated transcoder
     * @param _betterTranscoder Address of a transcoder with more stake than the updated transcoder
     */
    function increaseTranscoderStake(Data storage self, address _transcoder, uint256 _amount, address _worseTranscoder, address _betterTranscoder) public {
        // List must contain the transcoder
        require(contains(self, _transcoder));

        // Compute new stake
        uint256 newStake = self.nodes[_transcoder].stake.add(_amount);
        // Remove transcoder from the list
        removeTranscoder(self, _transcoder);
        // Insert transcoder into the list with its new stake
        addTranscoder(self, _transcoder, newStake, _worseTranscoder, _betterTranscoder);
    }

    /*
     * @dev Decrease the stake of a transcoder in the list
     * @param _transcoder Address of transcoder
     * @param _amount Amount to decrease transcoder's stake by
     * @param _worseTranscoder Address of a transcoder with less stake than the updated transcoder
     * @param _betterTranscoder Address of a transcoder with more stake than the updated transcoder
     */
    function decreaseTranscoderStake(Data storage self, address _transcoder, uint256 _amount, address _worseTranscoder, address _betterTranscoder) public {
        // List must contain the transcoder
        require(contains(self, _transcoder));

        // Compute new stake
        uint256 newStake = self.nodes[_transcoder].stake.sub(_amount);
        // Remove transcoder from the list
        removeTranscoder(self, _transcoder);

        if (newStake > 0) {
            // Only add transcoder if its new stake is non-zero
            // Insert transcoder into the list with its new stake
            addTranscoder(self, _transcoder, newStake, _worseTranscoder, _betterTranscoder);
        }
    }

    /*
     * @dev Checks if the list contains a transcoder
     * @param _transcoder Address of transcoder
     */
    function contains(Data storage self, address _transcoder) public view returns (bool) {
        return self.head == _transcoder || self.tail == _transcoder || self.nodes[_transcoder].prevTranscoder != address(0) || self.nodes[_transcoder].nextTranscoder != address(0);
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
     * @dev Returns the stake of a transcoder in the list
     * @param _transcoder Address of transcoder
     */
    function getTranscoderStake(Data storage self, address _transcoder) public view returns (uint256) {
        return self.nodes[_transcoder].stake;
    }

    /*
     * @dev Returns the transcoder in the list with the least stake (the head)
     */
    function getWorstTranscoder(Data storage self) public view returns (address) {
        return self.head;
    }

    /*
     * @dev Returns the transcoder in the list with the most stake (the tail)
     */
    function getBestTranscoder(Data storage self) public view returns (address) {
        return self.tail;
    }

    /*
     * @dev Returns the previous transcoder in the list for a transcoder
     * @param _transcoder Address of transcoder
     */
    function getNextTranscoder(Data storage self, address _transcoder) public view returns (address) {
        return self.nodes[_transcoder].nextTranscoder;
    }

    /*
     * @dev Returns the next transcoder in the list for a transcoder
     * @param _transcoder Address of transcoder
     */
    function getPrevTranscoder(Data storage self, address _transcoder) public view returns (address) {
        return self.nodes[_transcoder].prevTranscoder;
    }

    /*
     * @dev Checks if a transcoder in the list has more stake than a given amount
     * @param _stake Stake amount
     * @param _betterTranscoder Address of transcoder
     */
    function isBetterTranscoder(Data storage self, uint256 _stake, address _betterTranscoder) public view returns (bool) {
        return contains(self, _betterTranscoder) && self.nodes[_betterTranscoder].stake >= _stake;
    }

    /*
     * @dev Checks if a transcoder in the list has less stake than a given amount
     * @param _stake
     * @param _worseTranscoder
     */
    function isWorseTranscoder(Data storage self, uint256 _stake, address _worseTranscoder) public view returns (bool) {
        return contains(self, _worseTranscoder) && self.nodes[_worseTranscoder].stake <= _stake;
    }

    /*
     * @dev Check if a pair of bounding transcoders is a valid insertion point for a new transcoder with the given stake
     * @param _stake Stake of a new transcoder
     * @param _worseTranscoder Address of transcoder in list with less stake than the given stake
     * @param _betterTranscoder Address of transcoder in list with more stake than the given stake
     */
    function correctBoundingTranscoders(Data storage self, uint256 _stake, address _worseTranscoder, address _betterTranscoder) public view returns (bool) {
        if (_worseTranscoder == address(0) && _betterTranscoder == address(0)) {
            // (null, null) is a valid insertion point if the list is empty
            return isEmpty(self);
        } else if (_worseTranscoder == address(0)) {
            // (null, _betterTranscoder) is a valid insertion point if _betterTranscoder is the head of the list
            return self.head == _betterTranscoder && isBetterTranscoder(self, _stake, _betterTranscoder);
        } else if (_betterTranscoder == address(0)) {
            // (_worseTranscoder, null) is a valid insertion point if _worseTranscoder is the tail of the list
            return self.tail == _worseTranscoder && isWorseTranscoder(self, _stake, _worseTranscoder);
        } else {
            return self.nodes[_worseTranscoder].nextTranscoder == _betterTranscoder && isWorseTranscoder(self, _stake, _worseTranscoder) && isBetterTranscoder(self, _stake, _betterTranscoder);
        }
    }

    /*
     * @dev Ascend the list starting from _worstTranscoder to find an insertion point, a pair of bounding transcoders, for a new transcoder with the given stake
     * @param _stake Stake of a new transcoder to be inserted into the list
     * @param _worstTranscoder Address of transcoder in list which is the starting point for the ascent
     */
    function ascendTranscoders(Data storage self, uint256 _stake, address _worstTranscoder) private view returns (address, address) {
        // If _worstTranscoder is the head, check if the insertion point is before the head
        if (self.head == _worstTranscoder && isBetterTranscoder(self, _stake, _worstTranscoder)) {
            return (address(0), _worstTranscoder);
        }

        address worseTranscoder = _worstTranscoder;
        address betterTranscoder = self.nodes[worseTranscoder].nextTranscoder;

        // Ascend the list until we reach the end or until we find a valid insertion point
        while (worseTranscoder != address(0) && !correctBoundingTranscoders(self, _stake, worseTranscoder, betterTranscoder)) {
            worseTranscoder = self.nodes[worseTranscoder].nextTranscoder;
            betterTranscoder = self.nodes[worseTranscoder].nextTranscoder;
        }

        return (worseTranscoder, betterTranscoder);
    }

    /*
     * @dev Descend the list starting from _bestTranscoder to find an insertion point, a pair of bounding transcoders, for a new transcoder with the given stake
     * @param _stake Stake of a new transcoder to be inserted into the list
     * @param _bestTranscoder Address of transcoder in list which is the starting point for the descent
     */
    function descendTranscoders(Data storage self, uint256 _stake, address _bestTranscoder) private view returns (address, address) {
        // If _bestTranscoder is the tail, check if the insertion point is after the tail
        if (self.tail == _bestTranscoder && isWorseTranscoder(self, _stake, _bestTranscoder)) {
            return (_bestTranscoder, address(0));
        }

        address betterTranscoder = _bestTranscoder;
        address worseTranscoder = self.nodes[betterTranscoder].prevTranscoder;

        // Descend the list until we reach the end or until we find a valid insertion point
        while (betterTranscoder != address(0) && !correctBoundingTranscoders(self, _stake, worseTranscoder, betterTranscoder)) {
            betterTranscoder = self.nodes[betterTranscoder].prevTranscoder;
            worseTranscoder = self.nodes[betterTranscoder].prevTranscoder;
        }

        return (worseTranscoder, betterTranscoder);
    }

    /*
     * @dev Find the insertion position, a pair of bounding transcoders in the list, for a given stake value. Optionally accepts a hint
     * @param _stake Stake for a new transcoder to be inserted into the list
     * @param _worseTranscoder Address of a transcoder with less stake than the given stake
     * @param _betterTranscoder Address of a transcoder with more stake than the given stake
     */
    function findBoundingTranscoders(Data storage self, uint256 _stake, address _worseTranscoder, address _betterTranscoder) private view returns (address, address) {
        address worseTranscoder = _worseTranscoder;
        address betterTranscoder = _betterTranscoder;

        if (worseTranscoder != address(0)) {
            if (!contains(self, worseTranscoder)) {
                // Set worseTranscoder to null if it is not in the list
                worseTranscoder = address(0);
            } else {
                // worseTranscoder must have stake less than or equal to the given stake
                require(isWorseTranscoder(self, _stake, worseTranscoder));
            }
        }

        if (betterTranscoder != address(0)) {
            if (!contains(self, betterTranscoder)) {
                // Set betterTranscoder to null if it is not in the list
                betterTranscoder = address(0);
            } else {
                // betterTranscoder must have stake greater than or equal to the given stake
                require(isBetterTranscoder(self, _stake, betterTranscoder));
            }
        }

        if (worseTranscoder == address(0) && betterTranscoder == address(0)) {
            // Ascend list starting from the head
            return ascendTranscoders(self, _stake, self.head);
        } else if (worseTranscoder == address(0)) {
            // Descend list starting from betterTranscoder
            return descendTranscoders(self, _stake, betterTranscoder);
        } else if (betterTranscoder == address(0)) {
            // Ascend list starting from worseTranscoder
            return ascendTranscoders(self, _stake, worseTranscoder);
        } else {
            // Ascend list starting from worseTranscoder
            return ascendTranscoders(self, _stake, worseTranscoder);
        }
    }
}
