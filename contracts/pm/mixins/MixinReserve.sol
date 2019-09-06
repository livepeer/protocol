pragma solidity ^0.4.25;
// solium-disable-next-line
pragma experimental ABIEncoderV2;

import "./interfaces/MReserve.sol";
import "./interfaces/MContractRegistry.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";


contract MixinReserve is MContractRegistry, MReserve {
    using SafeMath for uint256;

    struct Reserve {
        uint256 funds;                                                     // Amount of funds in the reserve
        mapping (uint256 => uint256) claimableForRound;                    // Mapping of round => claimable amount due to a frozen reserve
        mapping (uint256 => mapping (address => uint256)) claimedForRound; // Mapping of round => claimant address => amount claimed
    }

    // Mapping of address => reserve
    mapping (address => Reserve) internal reserves;

    /**
     * @dev Returns info about a reserve
     * @param _reserveHolder Address of reserve holder
     * @return Info about the reserve for `_reserveHolder`
     */
    function getReserveInfo(address _reserveHolder) public view returns (ReserveInfo memory info) {
        info.fundsRemaining = remainingReserve(_reserveHolder);
        info.state = reserveState(_reserveHolder);
    }

    /**
     * @dev Returns the amount of funds claimable by a claimant from a reserve
     * @param _reserveHolder Address of reserve holder
     * @param _claimant Address of claimant
     * @return Amount of funds claimable by `_claimant` from the reserve for `_reserveHolder`
     */
    function claimableReserve(address _reserveHolder, address _claimant) public view returns (uint256) {
        Reserve storage reserve = reserves[_reserveHolder];

        uint256 currentRound = roundsManager().currentRound();

        // TODO: Check if claimant is active in the current round
        // We are just checking if it is registered for now
        if (!bondingManager.isRegisteredTranscoder(_claimant)) {
            return 0;
        }

        uint256 poolSize = bondingManager().getTranscoderPoolSize();
        if poolSize == 0 {
            return 0;
        }

        if (reserve.claimableForRound[currentRound] == 0) {
            return reserve.funds.div(poolSize);
        } else {
            return reserve.claimableForRound[currentRound].div(poolSize).sub(reserve.claimedForRound[currentRound][_claimant]);
        }
    }

    /**
     * @dev Returns the amount of funds claimed by a claimant from a reserve
     * @param _reserveHolder Address of reserve holder
     * @param _claimant Address of claimant
     * @return Amount of funds claimed by `_claimant` from the reserve for `_reserveHolder`
     */
    function claimedReserve(address _reserveHolder, address _claimant) public view returns (uint256) {
        Reserve storage reserve = reserves[_reserveHolder];
        uint256 currentRound = roundsManager().currentRound();
        return reserve.claimedForRound[currentRound][_claimant];
    }

    /**
     * @dev Adds funds to a reserve
     * @param _reserveHolder Address of reserve holder
     * @param _amount Amount of funds to add to reserve
     */
    function addReserve(address _reserveHolder, uint256 _amount) internal {
        Reserve storage reserve = reserves[_reserveHolder];
        reserve.funds = reserve.funds.add(_amount);

        if (reserveState(_reserveHolder) == ReserveState.Frozen) {
            uint256 currentRound = roundsManager().currentRound();
            reserve.claimableForRound[currentRound] = reserve.claimableForRound[currentRound].add(_amount);
        }

        emit ReserveFunded(_reserveHolder, _amount);
    }

    /**
     * @dev Clears contract storage used for a reserve
     * @param _reserveHolder Address of reserve holder
     */
    function clearReserve(address _reserveHolder) internal {
        delete reserves[_reserveHolder];
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
        Reserve storage reserve = reserves[_reserveHolder];

        uint256 currentRound = roundsManager().currentRound();
        uint256 numRecipients = bondingManager().getTranscoderPoolSize();

        // If reserve is not frozen then freeze it
        if (reserveState(_reserveHolder) == ReserveState.NotFrozen) {
            reserve.claimableForRound[currentRound] = reserve.funds;

            emit ReserveFrozen(
                _reserveHolder,
                _claimant,
                currentRound,
                numRecipients
            );
        }

        // If the reserve is not frozen or if there are no recipients
        // registered with BondingManager during the freezeRound then
        // no funds can be claimed from the reserve
        if (reserve.claimableForRound[currentRound] == 0 || numRecipients == 0) {
            return 0;
        }

        // If claimant is not registered it cannot claim any funds
        // from the reserve
        //
        // TODO: Check if claimant is active in the current round
        // We are just checking if it is registered for now
        if (!bondingManager().isRegisteredTranscoder(_claimant)) {
            return 0;
        }

        uint256 claimedFunds = reserve.claimedForRound[currentRound][_claimant];
        // Amount claimable from reserve by claimant = max allocation from reserve for claimant - amount already claimed by claimant
        uint256 claimableFunds = reserve.claimableForRound[currentRound].div(numRecipients).sub(claimedFunds);
        // If the given amount > claimableFunds then claim claimableFunds
        // If the given amount <= claimableFunds then claim the given amount
        uint256 claimAmount = _amount > claimableFunds ? claimableFunds : _amount;

        if (claimAmount > 0) {
            reserve.claimedForRound[currentRound][_claimant] = claimedFunds.add(claimAmount);
            reserve.funds = reserve.funds.sub(claimAmount);

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
        Reserve storage reserve = reserves[_reserveHolder].reserve;

        uint256 currentRound = roundsManager().currentRound();

        if (reserve.claimableForRound[currentRound] > 0) {
            return ReserveState.Frozen;
        } else {
            return ReserveState.NotFrozen;
        } 
    }

    /**
     * @dev Returns the amount of funds remaining in a reserve
     * @param _reserveHolder Address of reserve holder
     * @return Amount of funds remaining in the reserve for `_reserveHolder`
     */
    function remainingReserve(address _reserveHolder) internal view returns (uint256) {
        return reserves[_reserveHolder].funds;
    }