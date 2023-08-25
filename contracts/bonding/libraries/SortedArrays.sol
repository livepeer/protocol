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

    error DecreasingValues(uint256 newValue, uint256 lastValue);

    /**
     * @notice Searches a sorted _array and returns the last element to be lower or equal to _val. If there is no such
     * element (all elements in array are higher than the searched element), the array length is returned.
     *
     * @dev This basically converts OpenZeppelin's {Arrays-findUpperBound} into findLowerBound, meaning it also uses a
     * binary search in the worst case after trying some shortcuts. Worst case time complexity is O(log n). The only
     * change being that the returned index points to the element lower or equal to _val, instead of higher or equal.
     * @param _array Array to search in
     * @param _val Value to search for
     * @return lower Index of the lower bound found in array
     */
    function findLowerBound(uint256[] storage _array, uint256 _val) internal view returns (uint256) {
        uint256 len = _array.length;
        if (len == 0) {
            return 0;
        }

        if (_array[len - 1] <= _val) {
            return len - 1;
        }

        uint256 upperIdx = _array.findUpperBound(_val);

        // we already checked the last element above so the upper will always be inside the array
        assert(upperIdx < len);

        // the exact value we were searching is in the array
        if (_array[upperIdx] == _val) {
            return upperIdx;
        }

        // a 0 idx means that the first elem is already higher than the searched value (and not equal, checked above)
        if (upperIdx == 0) {
            return len;
        }

        // the element at upperIdx is the first element higher than the value we want, so return the previous element
        return upperIdx - 1;
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
            if (val < last) {
                revert DecreasingValues(val, last);
            }

            // don't push duplicate values
            if (val != last) {
                array.push(val);
            }
        }
    }
}
