pragma solidity 0.8.4;

abstract contract MReserve {
    struct ReserveInfo {
        uint256 fundsRemaining; // Funds remaining in reserve
        uint256 claimedInCurrentRound; // Funds claimed from reserve in current round
    }

    struct Reserve {
        uint256 funds; // Amount of funds in the reserve
        mapping(uint256 => uint256) claimedForRound; // Mapping of round => total amount claimed
        mapping(uint256 => mapping(address => uint256)) claimedByAddress; // Mapping of round => claimant address => amount claimed
    }

    // Emitted when funds are added to a reserve
    event ReserveFunded(address indexed reserveHolder, uint256 amount);
    // Emitted when funds are claimed from a reserve
    event ReserveClaimed(address indexed reserveHolder, address claimant, uint256 amount);
}
