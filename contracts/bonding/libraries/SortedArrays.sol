// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../../libraries/MathUtils.sol";

import "@openzeppelin/contracts/utils/Arrays.sol";

/**
 * @title SortedArrays
 * @dev Handles maintaining and looking up on sorted uint256 arrays.
 */
library SortedArrays {
    using Arrays for uint256[];

    /**
     * @notice Searches a sorted _array and returns the last element to be lower or equal to _val.
     *
     * @dev This basically converts OpenZeppelin's {Arrays-findUpperBound} into findLowerBound, meaning it also uses a
     * binary search in the worst case after trying some shortcuts. Worst case time complexity is O(log n).
     *
     * The main differences from the OZ version (apart from the obvious lower vs upper bound) are:
     *  - It returns the array element directly instead of its index
     *  - If no such element exists (i.e. all values in the array are higher than _val) this function will fail instead
     *    of returning some default value.
     * @param _array Array to search in
     * @param _val Value to search for
     * @return lower Lower bound value found in array
     */
    function findLowerBound(uint256[] storage _array, uint256 _val) internal view returns (uint256) {
        uint256 len = _array.length;
        require(len > 0, "findLowerBound: empty array");

        uint256 lastElm = _array[len - 1];
        if (lastElm <= _val) {
            return lastElm;
        }

        uint256 upperIdx = _array.findUpperBound(_val);

        // we already checked the last element above so the upper will always be inside the array
        assert(upperIdx < len);

        uint256 upperElm = _array[upperIdx];
        // the exact value we were searching is in the array
        if (upperElm == _val) {
            return upperElm;
        }

        // a 0 idx means that the first elem is already higher than the searched value (and not equal, checked above)
        require(upperIdx > 0, "findLowerBound: all values in array are higher than searched value");

        // the upperElm is the first element higher than the value we want, so return the previous element
        return _array[upperIdx - 1];
    }

    /**
     * @notice Pushes a value into an already sorted array.
     * @dev Values must be pushed in increasing order as to avoid shifting values in the array. This function only
     * guarantees that the pushed value will not create duplicates nor make the array out of order.
     * @param array Array to push the value into
     * @param val Value to push into array. Must be greater than or equal to the highest (last) element.
     */
    function pushSorted(uint256[] storage array, uint256 val) internal {
        if (array.length == 0) {
            array.push(val);
        } else {
            uint256 last = array[array.length - 1];

            // values must be pushed in order
            require(val >= last, "pushSorted: decreasing values");

            // don't push duplicate values
            if (val != last) {
                array.push(val);
            }
        }
    }
}
