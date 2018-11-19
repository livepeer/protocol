pragma solidity ^0.4.25;


contract TicketBroker {

    struct Sender {
        uint256 deposit;
        uint256 penaltyEscrow;
    }

    uint256 public minPenaltyEscrow;

    mapping (address => Sender) public senders;

    event DepositFunded(address indexed sender, uint256 amount);
    event PenaltyEscrowFunded(address indexed sender, uint256 amount);

    constructor(uint256 _minPenaltyEscrow) public {
        minPenaltyEscrow = _minPenaltyEscrow;
    }

    function fundDeposit() external payable {
        senders[msg.sender].deposit += msg.value;

        emit DepositFunded(msg.sender, msg.value);
    }

    function fundPenaltyEscrow() external payable {
        require(msg.value >= minPenaltyEscrow, "tx value must be >= minPenaltyEscrow");

        senders[msg.sender].penaltyEscrow += msg.value;

        emit PenaltyEscrowFunded(msg.sender, msg.value);
    }
}