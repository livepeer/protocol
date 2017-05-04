pragma solidity  ^0.4.8;

import "./MinHeap.sol";

contract MinHeapMock {
    using MinHeap for MinHeap.Heap;

    MinHeap.Heap public heap;

    function init(uint _size) {
        heap.init(_size);
    }

    function insert(address _addr, uint _key) {
        heap.insert(_addr, _key);
    }

    function deleteMin() {
        heap.deleteMin();
    }

    function min() constant returns (address, uint) {
        return heap.min();
    }
}
