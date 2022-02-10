// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

abstract contract MReserve {
    struct ReserveInfo {
        uint256 fundsRemaining; // Funds remaining in reserve
        uint256 claimedInCurrentRound; // Funds claimed from reserve in current round
    }

    // Emitted when funds are added to a reserve
    event ReserveFunded(address indexed reserveHolder, uint256 amount);
    // Emitted when funds are claimed from a reserve
    event ReserveClaimed(address indexed reserveHolder, address claimant, uint256 amount);

    /**
     * @notice Returns info about a reserve
     * @param _reserveHolder Address of reserve holder
     * @return info Info about the reserve for `_reserveHolder`
     */
    function getReserveInfo(address _reserveHolder) public view virtual returns (ReserveInfo memory info);

    /**
     * @notice Returns the amount of funds claimed by a claimant from a reserve
     * @param _reserveHolder Address of reserve holder
     * @param _claimant Address of claimant
     * @return Amount of funds claimed by `_claimant` from the reserve for `_reserveHolder`
     */
    function claimedReserve(address _reserveHolder, address _claimant) public view virtual returns (uint256);

    /**
     * @dev Adds funds to a reserve
     * @param _reserveHolder Address of reserve holder
     * @param _amount Amount of funds to add to reserve
     */
    function addReserve(address _reserveHolder, uint256 _amount) internal virtual;

    /**
     * @dev Clears contract storage used for a reserve
     * @param _reserveHolder Address of reserve holder
     */
    function clearReserve(address _reserveHolder) internal virtual;

    /**
     * @dev Claims funds from a reserve
     * @param _reserveHolder Address of reserve holder
     * @param _claimant Address of claimant
     * @param _amount Amount of funds to claim from the reserve
     * @return Amount of funds (<= `_amount`) claimed by `_claimant` from the reserve for `_reserveHolder`
     */
    function claimFromReserve(
        address _reserveHolder,
        address _claimant,
        uint256 _amount
    ) internal virtual returns (uint256);

    /**
     * @dev Returns the amount of funds remaining in a reserve
     * @param _reserveHolder Address of reserve holder
     * @return Amount of funds remaining in the reserve for `_reserveHolder`
     */
    function remainingReserve(address _reserveHolder) internal view virtual returns (uint256);
}
