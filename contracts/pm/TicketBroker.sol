pragma solidity ^0.4.25;
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/cryptography/ECDSA.sol";


contract TicketBroker {

    struct Sender {
        uint256 deposit;
        uint256 penaltyEscrow;
    }

    struct Ticket {
        address recipient;
        uint256 faceValue;
        uint256 winProb;
        uint256 senderNonce;
        bytes32 recipientRandHash;
        uint256 creationTimestamp;
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

    function redeemWinningTicket(Ticket _ticket, bytes _senderSig, uint256 _recipientRand) public {
        require(_ticket.recipient != address(0), "ticket recipient is null address");
        require(
            keccak256(abi.encodePacked(_recipientRand)) == _ticket.recipientRandHash,
            "recipientRand does not match recipientRandHash"
        );

        bytes32 ticketHash = keccak256(
            abi.encodePacked(
                _ticket.recipient,
                _ticket.faceValue,
                _ticket.winProb,
                _ticket.senderNonce,
                _ticket.recipientRandHash,
                _ticket.creationTimestamp
            )
        );
        address sender = ECDSA.recover(ticketHash, _senderSig);

        require(sender != address(0), "invalid sender signature over ticket hash");
    }
}