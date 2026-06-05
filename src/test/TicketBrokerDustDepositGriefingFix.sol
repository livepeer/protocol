// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "./TicketBrokerDustDepositGriefingPoC.sol";
import { TicketBroker } from "contracts/pm/TicketBroker.sol";

// forge test --match-contract TicketBrokerDustDepositGriefingFix --fork-url <ARB_MAINNET_RPC_URL> -vvv
contract TicketBrokerDustDepositGriefingFix is TicketBrokerDustDepositGriefingPoC {
    function _upgradeTicketBroker() internal {
        TicketBroker newTicketBrokerTarget = new TicketBroker(address(CONTROLLER));

        stageAndExecuteOne(
            address(CONTROLLER),
            0,
            abi.encodeWithSelector(
                CONTROLLER.setContractInfo.selector,
                keccak256(abi.encodePacked("TicketBrokerTarget")),
                address(newTicketBrokerTarget),
                bytes32(0)
            )
        );
    }

    function testFixDustDepositGriefing() public {
        _upgradeTicketBroker();

        (MixinTicketBrokerCore.Sender memory info, ) = TICKET_BROKER.getSenderInfo(sender);
        assertEq(info.deposit, 0);
        assertEq(TICKET_BROKER.getReserveInfo(sender).fundsRemaining, 0);

        (MTicketBrokerCore.Ticket memory ticket, bytes memory sig, uint256 rand) = _createSignedTicket(
            victimTranscoder,
            sender,
            1 ether
        );

        CHEATS.prank(attacker);
        TICKET_BROKER.fundDepositAndReserveFor{ value: 1 wei }(sender, 1 wei, 0);

        (info, ) = TICKET_BROKER.getSenderInfo(sender);
        assertEq(info.deposit, 1 wei);

        CHEATS.prank(victimTranscoder);
        CHEATS.expectRevert("sender deposit and reserve insufficient to cover ticket face value");
        TICKET_BROKER.redeemWinningTicket(ticket, sig, rand);

        assertFalse(TICKET_BROKER.usedTickets(TICKET_BROKER.getTicketHash(ticket)));
    }

    function testFixRaceConditionPartialPayout() public {
        _upgradeTicketBroker();

        address anotherTranscoder = BONDING_MANAGER.getNextTranscoderInPool(victimTranscoder);
        uint256 faceValue = 1 ether;

        CHEATS.prank(sender);
        TICKET_BROKER.fundDepositAndReserve{ value: faceValue + faceValue / 2 }(faceValue + faceValue / 2, 0);

        (MTicketBrokerCore.Ticket memory ticket1, bytes memory sig1, uint256 rand1) = _createSignedTicket(
            anotherTranscoder,
            sender,
            faceValue
        );
        (MTicketBrokerCore.Ticket memory ticket2, bytes memory sig2, uint256 rand2) = _createSignedTicket(
            victimTranscoder,
            sender,
            faceValue
        );

        CHEATS.expectEmit(true, true, true, true);
        emit WinningTicketTransfer(sender, anotherTranscoder, faceValue);
        CHEATS.prank(anotherTranscoder);
        TICKET_BROKER.redeemWinningTicket(ticket1, sig1, rand1);

        (MixinTicketBrokerCore.Sender memory info, ) = TICKET_BROKER.getSenderInfo(sender);
        assertEq(info.deposit, faceValue / 2);

        CHEATS.prank(victimTranscoder);
        CHEATS.expectRevert("sender deposit and reserve insufficient to cover ticket face value");
        TICKET_BROKER.redeemWinningTicket(ticket2, sig2, rand2);

        assertFalse(TICKET_BROKER.usedTickets(TICKET_BROKER.getTicketHash(ticket2)));
    }

    function testNormalRedemption() public {
        _upgradeTicketBroker();

        uint256 faceValue = 1 ether;

        CHEATS.prank(sender);
        TICKET_BROKER.fundDepositAndReserve{ value: faceValue }(faceValue, 0);

        (MTicketBrokerCore.Ticket memory ticket, bytes memory sig, uint256 rand) = _createSignedTicket(
            victimTranscoder,
            sender,
            faceValue
        );

        CHEATS.expectEmit(true, true, true, true);
        emit WinningTicketTransfer(sender, victimTranscoder, faceValue);
        CHEATS.prank(victimTranscoder);
        TICKET_BROKER.redeemWinningTicket(ticket, sig, rand);

        assertTrue(TICKET_BROKER.usedTickets(TICKET_BROKER.getTicketHash(ticket)));

        (MixinTicketBrokerCore.Sender memory info, ) = TICKET_BROKER.getSenderInfo(sender);
        assertEq(info.deposit, 0);
    }
}
