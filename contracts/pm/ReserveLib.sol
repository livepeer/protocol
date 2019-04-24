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
        mapping (uint256 => mapping (address => uint256)) claimed;
    }

    function fund(ReserveManager storage manager, uint256 _amount) internal {
        Reserve storage reserve = manager.reserve;
        reserve.fundsAdded = reserve.fundsAdded.add(_amount);
    }

    function clear(ReserveManager storage manager) internal {
        delete manager.reserve;
        manager.reserveNonce = manager.reserveNonce.add(1);
    }

    function fundsRemaining(ReserveManager storage manager) internal view returns (uint256) {
        Reserve storage reserve = manager.reserve;
        return reserve.fundsAdded.sub(reserve.fundsClaimed);
    }
}