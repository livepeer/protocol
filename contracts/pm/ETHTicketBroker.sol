pragma solidity ^0.4.25;
// solium-disable-next-line
pragma experimental ABIEncoderV2;

import "./TicketBroker.sol";


contract ETHTicketBroker is TicketBroker {
    constructor(
        uint256 _minPenaltyEscrow, 
        uint256 _unlockPeriod,
        uint256 _signerRevocationPeriod
    ) 
        TicketBroker(_minPenaltyEscrow, _unlockPeriod, _signerRevocationPeriod) 
        public 
    {}

    function processFunding(uint256 _amount) internal {}

    function withdrawTransfer(address _sender, uint256 _amount) internal {
        _sender.transfer(_amount);
    }

    function winningTicketTransfer(address _recipient, uint256 _amount) internal {
        _recipient.transfer(_amount);
    }

    function penaltyEscrowSlash(uint256 _amount) internal {
        address(0).transfer(_amount);
    }

    function requireValidTicketAuxData(bytes _auxData) internal view {
        require(
            getCreationTimestamp(_auxData).add(3 days) > block.timestamp,
            "ticket is expired"
        );
    }

    function getCreationTimestamp(bytes _auxData) internal pure returns (uint256 creationTimestamp) {
        assembly {
            creationTimestamp := mload(add(_auxData, 32))
        }
    }
}