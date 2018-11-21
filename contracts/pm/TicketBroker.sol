pragma solidity ^0.4.25;
// solium-disable-next-line
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/cryptography/ECDSA.sol";


contract TicketBroker {

    struct Sender {
        uint256 deposit;
        uint256 penaltyEscrow;
    }

    struct Ticket {
        address recipient;
        address sender;
        uint256 faceValue;
        uint256 winProb;
        uint256 senderNonce;
        bytes32 recipientRandHash;
        uint256 creationTimestamp;
    }

    uint256 public minPenaltyEscrow;

    mapping (address => Sender) public senders;
    mapping (bytes32 => bool) public usedTickets;

    event DepositFunded(address indexed sender, uint256 amount);
    event PenaltyEscrowFunded(address indexed sender, uint256 amount);
    event WinningTicketRedeemed(
        address indexed sender,
        address indexed recipient,
        uint256 faceValue,
        uint256 winProb,
        uint256 senderNonce,
        uint256 recipientRand,
        uint256 creationTimestamp
    );
    event WinningTicketTransfer(address indexed sender, address indexed recipient, uint256 amount);
    event PenaltyEscrowSlashed(address indexed sender, address indexed recipient, uint256 amount);

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

    function redeemWinningTicket(Ticket memory _ticket, bytes _sig, uint256 _recipientRand) public {
        bytes32 ticketHash = getTicketHash(_ticket);

        requireValidWinningTicket(_ticket, ticketHash, _sig, _recipientRand);

        Sender storage sender = senders[_ticket.sender];

        require(
            sender.deposit > 0 || sender.penaltyEscrow > 0,
            "sender deposit and penalty escrow are zero"
        );

        usedTickets[ticketHash] = true;

        uint256 amountToTransfer = 0;
        uint256 amountToSlash = 0;

        if (_ticket.faceValue > sender.deposit) {
            amountToTransfer = sender.deposit;
            amountToSlash = sender.penaltyEscrow;

            sender.deposit = 0;
            sender.penaltyEscrow = 0;
        } else {
            amountToTransfer = _ticket.faceValue;
            sender.deposit -= _ticket.faceValue;
        }

        if (amountToSlash > 0) {
            address(0).transfer(amountToSlash);

            emit PenaltyEscrowSlashed(_ticket.sender, _ticket.recipient, amountToSlash);
        }

        if (amountToTransfer > 0) {
            _ticket.recipient.transfer(amountToTransfer);

            emit WinningTicketTransfer(_ticket.sender, _ticket.recipient, amountToTransfer);
        }

        emit WinningTicketRedeemed(
            _ticket.sender,
            _ticket.recipient,
            _ticket.faceValue,
            _ticket.winProb,
            _ticket.senderNonce,
            _recipientRand,
            _ticket.creationTimestamp
        );
    }

    function requireValidWinningTicket(
        Ticket memory _ticket,
        bytes32 _ticketHash,
        bytes _sig,
        uint256 _recipientRand
    ) 
        internal
        view
    {
        require(_ticket.recipient != address(0), "ticket recipient is null address");
        require(_ticket.sender != address(0), "ticket sender is null address");
        // TODO: Parameterize the ticket validity period instead of using hardcoded 3 days
        require(_ticket.creationTimestamp + 3 days > block.timestamp, "ticket is expired");

        require(
            keccak256(abi.encodePacked(_recipientRand)) == _ticket.recipientRandHash,
            "recipientRand does not match recipientRandHash"
        );

        require(!usedTickets[_ticketHash], "ticket is used");

        require(
            isValidTicketSig(_ticket.sender, _sig, _ticketHash), 
            "invalid signature over ticket hash"
        );

        require(
            isWinningTicket(_ticketHash, _recipientRand, _ticket.winProb),
            "ticket did not win"
        );
    }

    function getTicketHash(Ticket memory _ticket) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                _ticket.recipient,
                _ticket.sender,
                _ticket.faceValue,
                _ticket.winProb,
                _ticket.senderNonce,
                _ticket.recipientRandHash,
                _ticket.creationTimestamp
            )
        );
    }

    function isWinningTicket(bytes32 _ticketHash, uint256 _recipientRand, uint256 _winProb) internal pure returns (bool) {
        return uint256(keccak256(abi.encodePacked(_ticketHash, _recipientRand))) < _winProb;
    }

    function isValidTicketSig(address _sender, bytes _sig, bytes32 _ticketHash) internal pure returns (bool) {
        address signer = ECDSA.recover(ECDSA.toEthSignedMessageHash(_ticketHash), _sig);
        return signer != address(0) && _sender == signer;
    }
}