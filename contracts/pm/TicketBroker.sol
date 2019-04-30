pragma solidity ^0.4.25;
// solium-disable-next-line
pragma experimental ABIEncoderV2;

import "./ReserveLib.sol";
import "openzeppelin-solidity/contracts/cryptography/ECDSA.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";


contract TicketBroker {
    using SafeMath for uint256;
    using ReserveLib for ReserveLib.ReserveManager;

    struct Signer {
        bool approved;
        uint256 revocationBlock;
    }

    struct Sender {
        uint256 deposit;
        uint256 withdrawBlock;
        mapping (address => Signer) signers;
    }

    struct Ticket {
        address recipient;
        address sender;
        uint256 faceValue;
        uint256 winProb;
        uint256 senderNonce;
        bytes32 recipientRandHash;
        bytes auxData;
    }

    uint256 public unlockPeriod;
    uint256 public freezePeriod;
    uint256 public signerRevocationPeriod;

    mapping (address => Sender) public senders;
    mapping (bytes32 => bool) public usedTickets;

    mapping (address => ReserveLib.ReserveManager) internal reserveManagers;

    event DepositFunded(address indexed sender, uint256 amount);
    event ReserveFunded(address indexed sender, uint256 amount);
    event SignersApproved(address indexed sender, address[] approvedSigners);
    event SignersRevocationRequested(address indexed sender, address[] signers, uint256 revocationBlock);
    event WinningTicketRedeemed(
        address indexed sender,
        address indexed recipient,
        uint256 faceValue,
        uint256 winProb,
        uint256 senderNonce,
        uint256 recipientRand,
        bytes auxData
    );
    event WinningTicketTransfer(address indexed sender, address indexed recipient, uint256 amount);
    event ReserveClaimed(address indexed sender, address indexed recipient, uint256 amount);
    event ReserveFrozen(
        address indexed sender,
        address indexed recipient,
        uint256 freezeRound,
        uint256 recipientsInFreezeRound,
        uint256 reserveFunds
    );
    event Unlock(address indexed sender, uint256 startBlock, uint256 endBlock);
    event UnlockCancelled(address indexed sender);
    event Withdrawal(address indexed sender, uint256 deposit, uint256 reserve);

    modifier checkDepositReserveETHValueSplit(uint256 _depositAmount, uint256 _reserveAmount) {
        require(
            msg.value == _depositAmount.add(_reserveAmount),
            "msg.value does not equal sum of deposit amount and reserve amount"
        );

        _;
    }

    modifier reserveNotFrozen(address _sender) {
        require(
            !isReserveFrozen(reserveManagers[_sender]),
            "sender's reserve is frozen"
        );

        _;
    }

    modifier processDeposit(address _sender, uint256 _amount) {
        Sender storage sender = senders[_sender];
        sender.deposit = sender.deposit.add(_amount);
        if (_isUnlockInProgress(sender)) {
            _cancelUnlock(sender, _sender);
        }

        _;

        emit DepositFunded(_sender, _amount);
    }

    modifier processReserve(address _sender, uint256 _amount) {
        Sender storage sender = senders[_sender];
        reserveManagers[_sender].fund(_amount);
        if (_isUnlockInProgress(sender)) {
            _cancelUnlock(sender, _sender);
        }

        _;

        emit ReserveFunded(_sender, _amount);
    }

    constructor(
        uint256 _unlockPeriod,
        uint256 _freezePeriod,
        uint256 _signerRevocationPeriod
    )
        internal
    {
        unlockPeriod = _unlockPeriod;
        freezePeriod = _freezePeriod;
        signerRevocationPeriod = _signerRevocationPeriod;
    }

    function fundDeposit()
        external
        payable
        reserveNotFrozen(msg.sender)
        processDeposit(msg.sender, msg.value)
    {
        processFunding(msg.value);
    }

    function fundReserve()
        external
        payable
        reserveNotFrozen(msg.sender)
        processReserve(msg.sender, msg.value)
    {
        processFunding(msg.value);
    }

    function fundAndApproveSigners(
        uint256 _depositAmount,
        uint256 _reserveAmount,
        address[] _signers
    )
        external
        payable
        reserveNotFrozen(msg.sender)
        checkDepositReserveETHValueSplit(_depositAmount, _reserveAmount)
        processDeposit(msg.sender, _depositAmount)
        processReserve(msg.sender, _reserveAmount)
    {
        approveSigners(_signers);
        processFunding(msg.value);
    }

    function approveSigners(address[] _signers) public {
        Sender storage sender = senders[msg.sender];

        for (uint256 i = 0; i < _signers.length; i++) {
            Signer storage signer = sender.signers[_signers[i]];
            signer.approved = true;
            signer.revocationBlock = 0;
        }

        emit SignersApproved(msg.sender, _signers);
    }

    function requestSignersRevocation(address[] _signers) public {
        Sender storage sender = senders[msg.sender];
        uint256 revocationBlock = block.number + signerRevocationPeriod;

        for (uint256 i = 0; i < _signers.length; i++) {
            sender.signers[_signers[i]].revocationBlock = revocationBlock;
        }

        emit SignersRevocationRequested(msg.sender, _signers, revocationBlock);
    }

    function redeemWinningTicket(
        address _recipient,
        address _sender,
        uint256 _faceValue,
        uint256 _winProb,
        uint256 _senderNonce,
        bytes32 _recipientRandHash,
        bytes _auxData,
        bytes _sig,
        uint256 _recipientRand
    )
        public
    {
        Ticket memory _ticket = Ticket({
            recipient: _recipient,
            sender: _sender,
            faceValue: _faceValue,
            winProb: _winProb,
            senderNonce: _senderNonce,
            recipientRandHash: _recipientRandHash,
            auxData: _auxData
        });

        bytes32 ticketHash = getTicketHash(_ticket);

        requireValidWinningTicket(_ticket, ticketHash, _sig, _recipientRand);

        Sender storage sender = senders[_ticket.sender];
        ReserveLib.ReserveManager storage reserveManager = reserveManagers[_ticket.sender];

        require(
            sender.deposit > 0 || reserveManager.fundsRemaining() > 0,
            "sender deposit and reserve are zero"
        );

        usedTickets[ticketHash] = true;

        uint256 amountToTransfer = 0;

        if (_ticket.faceValue > sender.deposit) {
            amountToTransfer = sender.deposit.add(claimFromReserve(
                reserveManager,
                _ticket.sender,
                _ticket.recipient,
                _ticket.faceValue.sub(sender.deposit)
            ));

            sender.deposit = 0;
        } else {
            amountToTransfer = _ticket.faceValue;
            sender.deposit = sender.deposit.sub(_ticket.faceValue);
        }

        if (amountToTransfer > 0) {
            winningTicketTransfer(_ticket.recipient, amountToTransfer);

            emit WinningTicketTransfer(_ticket.sender, _ticket.recipient, amountToTransfer);
        }

        emit WinningTicketRedeemed(
            _ticket.sender,
            _ticket.recipient,
            _ticket.faceValue,
            _ticket.winProb,
            _ticket.senderNonce,
            _recipientRand,
            _ticket.auxData
        );
    }

    function unlock() public reserveNotFrozen(msg.sender) {
        Sender storage sender = senders[msg.sender];
        ReserveLib.ReserveManager storage reserveManager = reserveManagers[msg.sender];

        require(
            sender.deposit > 0 || reserveManager.fundsRemaining() > 0,
            "sender deposit and reserve are zero"
        );
        require(!_isUnlockInProgress(sender), "unlock already initiated");

        sender.withdrawBlock = block.number.add(unlockPeriod);

        emit Unlock(msg.sender, block.number, sender.withdrawBlock);
    }

    function cancelUnlock() public {
        Sender storage sender = senders[msg.sender];

        _cancelUnlock(sender, msg.sender);
    }

    function withdraw() public reserveNotFrozen(msg.sender) {
        Sender storage sender = senders[msg.sender];
        ReserveLib.ReserveManager storage reserveManager = reserveManagers[msg.sender];

        require(
            sender.deposit > 0 || reserveManager.fundsRemaining() > 0,
            "sender deposit and reserve are zero"
        );

        if (!reserveManager.isFrozen()) {
            require(
                _isUnlockInProgress(sender),
                "no unlock request in progress"
            );
            require(
                block.number >= sender.withdrawBlock,
                "account is locked"
            );
        }

        uint256 deposit = sender.deposit;
        uint256 reserve = reserveManager.fundsRemaining();
        sender.deposit = 0;
        reserveManager.clear();

        withdrawTransfer(msg.sender, deposit.add(reserve));

        emit Withdrawal(msg.sender, deposit, reserve);
    }

    function getReserve(address _sender) public view returns (ReserveLib.Reserve memory) {
        return reserveManagers[_sender].reserve;
    }

    function isUnlockInProgress(address _sender) public view returns (bool) {
        Sender memory sender = senders[_sender];
        return _isUnlockInProgress(sender);
    }

    function isApprovedSigner(address _sender, address _signer) public view returns (bool) {
        Signer memory signer = senders[_sender].signers[_signer];
        return signer.approved && (signer.revocationBlock == 0 || block.number < signer.revocationBlock);
    }

    function _cancelUnlock(Sender storage _sender, address _senderAddress) internal {
        require(_isUnlockInProgress(_sender), "no unlock request in progress");

        _sender.withdrawBlock = 0;

        emit UnlockCancelled(_senderAddress);
    }

    // Override
    function processFunding(uint256 _amount) internal;

    // Override
    function withdrawTransfer(address _sender, uint256 _amount) internal;

    // Override
    function winningTicketTransfer(address _recipient, uint256 _amount) internal;

    // Override
    function claimFromReserve(
        ReserveLib.ReserveManager storage manager,
        address _sender,
        address _recipient,
        uint256 _amount
    )
        internal
        returns (uint256);

    // Override
    function requireValidTicketAuxData(bytes _auxData) internal view;

    // Override
    function isReserveFrozen(ReserveLib.ReserveManager storage manager) internal view returns (bool);

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

        requireValidTicketAuxData(_ticket.auxData);

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
            isWinningTicket(_sig, _recipientRand, _ticket.winProb),
            "ticket did not win"
        );
    }

    function isValidTicketSig(
        address _sender,
        bytes _sig,
        bytes32 _ticketHash
    )
        internal
        view
        returns (bool)
    {
        address signer = ECDSA.recover(ECDSA.toEthSignedMessageHash(_ticketHash), _sig);
        return signer != address(0) && (_sender == signer || isApprovedSigner(_sender, signer));
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
                _ticket.auxData
            )
        );
    }

    function isWinningTicket(bytes _sig, uint256 _recipientRand, uint256 _winProb) internal pure returns (bool) {
        return uint256(keccak256(abi.encodePacked(_sig, _recipientRand))) < _winProb;
    }

    function _isUnlockInProgress(Sender memory sender) internal pure returns (bool) {
        return sender.withdrawBlock > 0;
    }
}