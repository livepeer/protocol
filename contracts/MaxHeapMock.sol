pragma solidity  ^0.4.8;

import "./MaxHeap.sol";

contract MaxHeapMock {
    using MaxHeap for MaxHeap.Heap;

    MaxHeap.Heap public heap;

    function init(uint _size) {
        heap.init(_size);
    }

    function contains(address _addr) constant returns (bool) {
        return heap.contains(_addr);
    }

    function getKey(address _addr) constant returns (uint256) {
        return heap.getKey(_addr);
    }

    function insert(address _addr, uint _key) {
        heap.insert(_addr, _key);
    }

    function extractMax() {
        heap.extractMax();
    }

    function increaseKey(address _addr, uint _key) {
        heap.increaseKey(_addr, _key);
    }

    function decreaseKey(address _addr, uint _key) {
        heap.decreaseKey(_addr, _key);
    }

    function deleteId(address _addr) {
        heap.deleteId(_addr);
    }

    function max() constant returns (address, uint) {
        return heap.max();
    }
}
