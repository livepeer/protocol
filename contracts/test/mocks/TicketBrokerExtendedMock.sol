// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;
import "../../pm/TicketBroker.sol";

contract TickerBrokerExtendedMock is TicketBroker {
    constructor(address _controller) TicketBroker(_controller) {}

    function checkResult(bytes calldata _sig, uint256 _recipientRand) external pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(_sig, _recipientRand)));
    }

    function validateAndCheckTicketOutcome(
        address _sender,
        bytes32 _ticketHash,
        bytes calldata _sig,
        uint256 _recipientRand,
        uint256 _winProb
    ) external pure returns (bool) {
        require(isValidTicketSig(_sender, _sig, _ticketHash), "invalid signature over ticket hash");
        return isWinningTicket(_sig, _recipientRand, _winProb);
    }
}
