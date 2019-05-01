pragma solidity ^0.4.25;


contract MReserve {
    // States for a reserve
    enum ReserveState {
        NotFrozen,
        Frozen,
        Thawed
    }

    // Emitted when funds are added to a reserve
    event ReserveFunded(address indexed reserveHolder, uint256 amount);
    // Emitted when funds are claimed from a frozen reserve
    event ReserveClaimed(address indexed reserveHolder, address claimant, uint256 amount);
    // Emitted when a reserve is frozen
    event ReserveFrozen(
        address indexed reserveHolder,
        address indexed claimant,
        uint256 freezeRound,
        uint256 recipientsInFreezeRound
    );

    /**
     * @dev Returns the amount of funds remaining in a reserve
     * @param _reserveHolder Address of reserve holder
     * @return Amount of funds remaining in the reserve for `_reserveHolder`
     */
    function remainingReserve(address _reserveHolder) public view returns (uint256);

    /**
     * @dev Returns the amount of funds claimed by a claimant from a reserve
     * @param _reserveHolder Address of reserve holder
     * @param _claimant Address of claimant
     * @return Amount of funds claimed by `_claimant` from the reserve for `_reserveHolder`
     */
    function claimedReserve(address _reserveHolder, address _claimant) public view returns (uint256);

    /**
     * @dev Adds funds to a reserve
     * @param _reserveHolder Address of reserve holder
     * @param _amount Amount of funds to add to reserve
     */
    function addReserve(address _reserveHolder, uint256 _amount) internal;

    /**
     * @dev Clears contract storage used for a reserve
     * @param _reserveHolder Address of reserve holder
     */
    function clearReserve(address _reserveHolder) internal;

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
    )
        internal
        returns (uint256);

    /**
     * @dev Returns the state of a reserve
     * @param _reserveHolder Address of reserve holder
     * @return State of the reserve for `_reserveHolder`
     */
    function reserveState(address _reserveHolder) internal view returns (ReserveState);
}