pragma solidity ^0.4.25;
// solium-disable-next-line
pragma experimental ABIEncoderV2;

import "./TicketBroker.sol";


contract ETHTicketBroker is TicketBroker {
    constructor(
        uint256 _minPenaltyEscrow, 
        uint256 _unlockPeriod
    ) 
        TicketBroker(_minPenaltyEscrow, _unlockPeriod) 
        public 
    {}

    function fundDeposit() 
        external
        payable
        processDeposit(msg.sender, msg.value)
    {}

    function fundPenaltyEscrow()
        external
        payable
        processPenaltyEscrow(msg.sender, msg.value)
    {}

    function withdraw() 
        external
        processWithdraw(msg.sender) 
    {
        Sender storage sender = senders[msg.sender];

        msg.sender.transfer(sender.deposit + sender.penaltyEscrow);
    }

    function winningTicketTransfer(address _recipient, uint256 _amount) internal {
        _recipient.transfer(_amount);
    }

    function penaltyEscrowSlash(uint256 _amount) internal {
        address(0).transfer(_amount);
    }

    function requireValidTicketAuxData(bytes _auxData) internal view {
        require(
            getCreationTimestamp(_auxData) + 3 days > block.timestamp,
            "ticket is expired"
        );
    }

    function getCreationTimestamp(bytes _auxData) internal pure returns (uint256 creationTimestamp) {
        assembly {
            creationTimestamp := mload(add(_auxData, 32))
        }
    }
}