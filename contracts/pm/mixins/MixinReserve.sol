pragma solidity ^0.4.25;

import "./interfaces/MReserve.sol";
import "./interfaces/MContractRegistry.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";


contract MixinReserve is MContractRegistry, MReserve {
    using SafeMath for uint256;

    struct Reserve {
        uint256 fundsAdded;               // Amount of funds added to the reserve
        uint256 fundsClaimed;             // Amount of funds claimed from the reserve
        uint256 freezeRound;              // Round that the reserve was frozen
        uint256 recipientsInFreezeRound;  // Number of recipients registered in BondingManager during freezeRound
    }

    struct ReserveManager {
        uint256 reserveNonce;                                                 // Current reserve ID
        Reserve reserve;                                                      // Storage pointer to a reserve
        mapping (uint256 => mapping (address => uint256)) claimedPerReserve;  // Mapping of reserve ID => claimant address => amount claimed for reserve ID
    }

    // Mapping of address => managed reserve for an address
    mapping (address => ReserveManager) internal reserveManagers;

    // Number of rounds before a frozen reserve thaws
    uint256 public freezePeriod;

    /**
     * @dev Returns the amount of funds remaining in a reserve
     * @param _reserveHolder Address of reserve holder
     * @return Amount of funds remaining in the reserve for `_reserveHolder`
     */
    function remainingReserve(address _reserveHolder) public view returns (uint256) {
        Reserve storage reserve = reserveManagers[_reserveHolder].reserve;
        return reserve.fundsAdded.sub(reserve.fundsClaimed);
    }

    /**
     * @dev Returns the amount of funds claimed by a claimant from a reserve
     * @param _reserveHolder Address of reserve holder
     * @param _claimant Address of claimant
     * @return Amount of funds claimed by `_claimant` from the reserve for `_reserveHolder`
     */
    function claimedReserve(address _reserveHolder, address _claimant) public view returns (uint256) {
        ReserveManager storage manager = reserveManagers[_reserveHolder];
        return manager.claimedPerReserve[manager.reserveNonce][_claimant];
    }

    /**
     * @dev Adds funds to a reserve
     * @param _reserveHolder Address of reserve holder
     * @param _amount Amount of funds to add to reserve
     */
    function addReserve(address _reserveHolder, uint256 _amount) internal {
        ReserveManager storage manager = reserveManagers[_reserveHolder];
        Reserve storage reserve = manager.reserve;

        reserve.fundsAdded = remainingReserve(_reserveHolder).add(_amount);

        // If reserve is thawed then clear unneeded contract storage
        // for the reserve and update the reserve while ensuring that
        // any additional funds are added to the remaining funds in the reserve
        if (reserveState(_reserveHolder) == ReserveState.Thawed) {
            // We clear these individual fields of the reserve instead
            // of using `clearReserve()` because we can directly update
            // fundsAdded with its new value instead of clearing the old
            // value and then setting its new value
            reserve.fundsClaimed = 0;
            reserve.freezeRound = 0;
            reserve.recipientsInFreezeRound = 0;
            // Increment reserveNonce so the manager can point to a new
            // mapping for tracking funds claimed from a reserve by
            // different claimants
            manager.reserveNonce = manager.reserveNonce.add(1);
        }

        emit ReserveFunded(_reserveHolder, _amount);
    }

    /**
     * @dev Clears contract storage used for a reserve
     * @param _reserveHolder Address of reserve holder
     */
    function clearReserve(address _reserveHolder) internal {
        ReserveManager storage manager = reserveManagers[_reserveHolder];
        delete manager.reserve;
        // Increment reserveNonce so the manager can point to a new
        // mapping for tracking funds claimed from a reserve by
        // different claimants
        manager.reserveNonce = manager.reserveNonce.add(1);
    }

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
        returns (uint256)
    {
        ReserveManager storage manager = reserveManagers[_reserveHolder];
        Reserve storage reserve = manager.reserve;

        // If reserve is not frozen then freeze it
        if (reserveState(_reserveHolder) == ReserveState.NotFrozen) {
            uint256 freezeRound = roundsManager().currentRound();
            // TODO: make sure bondingManager.getTranscoderPoolSize()
            // returns the locked in # registered for the freeze round
            uint256 recipientsInFreezeRound = bondingManager().getTranscoderPoolSize();

            reserve.freezeRound = freezeRound;
            reserve.recipientsInFreezeRound = recipientsInFreezeRound;

            emit ReserveFrozen(
                _reserveHolder,
                _claimant,
                freezeRound,
                recipientsInFreezeRound
            );
        }

        // If the reserve is not frozen or if there are no recipients
        // registered with BondingManager during the freezeRound then
        // no funds can be claimed from the reserve
        if (reserve.freezeRound == 0 || reserve.recipientsInFreezeRound == 0) {
            return 0;
        }

        // If claimant is not registered it cannot claim any funds
        // from the reserve
        //
        // TODO: consider just checking if recipient is registered
        // in current round vs. keeping track of all rounds that recipient
        // is registered in and checking if recipient was registered
        // during the freeze round (could be in the past)
        if (!bondingManager().isRegisteredTranscoder(_claimant)) {
            return 0;
        }

        uint256 reserveID = manager.reserveNonce;
        uint256 claimedFunds = manager.claimedPerReserve[reserveID][_claimant];
        // Amount claimable from reserve by claimant = max allocation from reserve for claimant - amount already claimed by claimant
        uint256 claimableFunds = reserve.fundsAdded.div(reserve.recipientsInFreezeRound).sub(claimedFunds);
        // If the given amount > claimableFunds then claim claimableFunds
        // If the given amount <= claimableFunds then claim the given amount
        uint256 claimAmount = _amount > claimableFunds ? claimableFunds : _amount;

        if (claimAmount > 0) {
            manager.claimedPerReserve[reserveID][_claimant] = claimedFunds.add(claimAmount);
            reserve.fundsClaimed = reserve.fundsClaimed.add(claimAmount);

            emit ReserveClaimed(_reserveHolder, _claimant, claimAmount);
        }

        return claimAmount;
    }

    /**
     * @dev Returns the state of a reserve
     * @param _reserveHolder Address of reserve holder
     * @return State of the reserve for `_reserveHolder`
     */
    function reserveState(address _reserveHolder) internal view returns (ReserveState) {
        Reserve storage reserve = reserveManagers[_reserveHolder].reserve;

        uint256 currentRound = roundsManager().currentRound();

        if (reserve.freezeRound == 0) {
            return ReserveState.NotFrozen;
        } else if (
            reserve.freezeRound > 0 &&
            reserve.freezeRound.add(freezePeriod) > currentRound
        ) {
            return ReserveState.Frozen;
        } else {
            return ReserveState.Thawed;
        }
    }
}
