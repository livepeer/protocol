pragma solidity ^0.4.25;
// solium-disable-next-line
pragma experimental ABIEncoderV2;

import "./TicketBroker.sol";


contract ETHTicketBroker is TicketBroker {
    constructor(
        uint256 _unlockPeriod,
        uint256 _freezePeriod,
        uint256 _signerRevocationPeriod
    )
        TicketBroker(_unlockPeriod, _freezePeriod, _signerRevocationPeriod)
        public
    {}

    function processFunding(uint256 _amount) internal {}

    function withdrawTransfer(address _sender, uint256 _amount) internal {
        _sender.transfer(_amount);
    }

    function winningTicketTransfer(address _recipient, uint256 _amount) internal {
        _recipient.transfer(_amount);
    }

    function claimFromReserve(
        ReserveLib.ReserveManager storage manager,
        address _sender,
        address _recipient,
        uint256 _amount
    )
        internal
        returns (uint256)
    {
        // TODO: add ETHTicketBroker specific logic for claiming from reserve
        return 0;
    }

    function requireValidTicketAuxData(bytes _auxData) internal view {
        require(
            getCreationTimestamp(_auxData).add(3 days) > block.timestamp,
            "ticket is expired"
        );
    }

    function requireValidFrozenReserveWithdrawal(ReserveLib.ReserveManager storage manager) internal view {}

    function getCreationTimestamp(bytes _auxData) internal pure returns (uint256 creationTimestamp) {
        assembly {
            creationTimestamp := mload(add(_auxData, 32))
        }
    }
}