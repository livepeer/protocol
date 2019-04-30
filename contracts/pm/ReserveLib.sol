pragma solidity ^0.4.25;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";


library ReserveLib {
    using SafeMath for uint256;

    struct Reserve {
        uint256 fundsAdded;
        uint256 fundsClaimed;
        uint256 freezeRound;
        uint256 recipientsInFreezeRound;
    }

    struct ReserveManager {
        uint256 reserveNonce;
        Reserve reserve;
        mapping (uint256 => mapping (address => uint256)) claimedPerReserve;
    }

    function fund(ReserveManager storage manager, uint256 _amount) internal {
        Reserve storage reserve = manager.reserve;

        uint256 addAmount = _amount;

        if (isFrozen(manager)) {
            addAmount = addAmount.add(fundsRemaining(manager));
            clear(manager);
        }

        reserve.fundsAdded = reserve.fundsAdded.add(addAmount);
    }

    function clear(ReserveManager storage manager) internal {
        delete manager.reserve;
        manager.reserveNonce = manager.reserveNonce.add(1);
    }

    function freeze(
        ReserveManager storage manager,
        uint256 _freezeRound,
        uint256 _recipientsInFreezeRound
    )
        internal
    {
        Reserve storage reserve = manager.reserve;

        reserve.freezeRound = _freezeRound;
        reserve.recipientsInFreezeRound = _recipientsInFreezeRound;
    }

    function claim(
        ReserveManager storage manager,
        address _claimant,
        uint256 _amount
    )
        internal
        returns (uint256)
    {
        Reserve storage reserve = manager.reserve;

        if (reserve.freezeRound == 0 || reserve.recipientsInFreezeRound == 0) {
            return 0;
        }

        uint256 reserveID = manager.reserveNonce;
        uint256 allocation = reserve.fundsAdded.div(reserve.recipientsInFreezeRound);
        uint256 claimedFunds = manager.claimedPerReserve[reserveID][_claimant];
        uint256 claimableFunds = allocation.sub(claimedFunds);

        if (_amount > claimableFunds) {
            manager.claimedPerReserve[reserveID][_claimant] = allocation;
            reserve.fundsClaimed = allocation;

            return claimableFunds;
        } else {
            manager.claimedPerReserve[reserveID][_claimant] = claimedFunds.add(_amount);
            reserve.fundsClaimed = reserve.fundsClaimed.add(_amount);

            return _amount;
        }
    }

    function claimed(ReserveManager storage manager, address _claimant) internal view returns (uint256) {
        return manager.claimedPerReserve[manager.reserveNonce][_claimant];
    }

    function fundsRemaining(ReserveManager storage manager) internal view returns (uint256) {
        Reserve storage reserve = manager.reserve;
        return reserve.fundsAdded.sub(reserve.fundsClaimed);
    }

    function isFrozen(ReserveManager storage manager) internal view returns (bool) {
        return manager.reserve.freezeRound > 0;
    }
}