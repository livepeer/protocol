// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "ds-test/test.sol";
import "./base/GovernorBaseTest.sol";
import "forge-std/console.sol";

import "contracts/bonding/BondingManager.sol";
import "contracts/rounds/RoundsManager.sol";
import "contracts/pm/TicketBroker.sol";
import "contracts/token/LivepeerToken.sol";

struct DelegatorData {
    uint256 bondedAmount;
    uint256 fees;
    address delegateAddress;
    uint256 delegatedAmount;
    uint256 startRound;
    uint256 lastClaimRound;
    uint256 nextUnbondingLockId;
}

struct TranscoderEarningsPoolData {
    uint256 totalStake;
    uint256 transcoderRewardCut;
    uint256 transcoderFeeShare;
    uint256 cumulativeRewardFactor;
    uint256 cumulativeFeeFactor;
}

struct TranscoderData {
    uint256 lastRewardRound;
    uint256 rewardCut;
    uint256 feeShare;
    uint256 lastActiveStakeUpdateRound;
    uint256 activationRound;
    uint256 deactivationRound;
    uint256 activeCumulativeRewards;
    uint256 cumulativeRewards;
    uint256 cumulativeFees;
    uint256 lastFeeRound;
}

interface IBondingManagerHelper {
    function getTranscoderEarningsPoolForRound(address _transcoder, uint256 _round)
        external
        view
        returns (TranscoderEarningsPoolData memory);

    function getTranscoder(address _transcoder) external view returns (TranscoderData memory);

    function getDelegator(address _delegator) external view returns (DelegatorData memory);
}

interface IRoundManager {
    function roundLength() external returns (uint256);

    function currentRound() external view returns (uint256);

    function initializeRound() external;
}

// forge test --match-contract BondingManagerFeeOverclaimFix --fork-url https://arbitrum-mainnet.infura.io/v3/$INFURA_KEY -vvv --fork-block-number 371152514
contract BondingManagerFeeOverclaimFix is GovernorBaseTest {
    LivepeerToken public constant TOKEN = LivepeerToken(0x289ba1701C2F088cf0faf8B3705246331cB8A839);
    IMinter public constant MINTER = IMinter(0xc20DE37170B45774e6CD3d2304017fc962f27252);
    BondingManager public constant BONDING_MANAGER = BondingManager(0x35Bcf3c30594191d53231E4FF333E8A770453e40);
    RoundsManager public constant ROUNDS_MANAGER = RoundsManager(0xdd6f56DcC28D3F5f27084381fE8Df634985cc39f);
    TicketBroker public constant TICKET_BROKER = TicketBroker(0xa8bB618B1520E284046F3dFc448851A1Ff26e41B);

    uint256 public constant ATTACKER_KEY = 3171;
    uint256 public constant TICKET_SENDER_KEY = 31337;

    uint256 public constant ATTACK_GRANULARITY = 1000 wei;

    uint256 roundLength;
    address ticketSender;

    bytes32 public constant BONDING_MANAGER_TARGET_ID = keccak256("BondingManagerTarget");
    BondingManager public newBondingManagerTarget;

    address attacker;
    address someone;

    function setUp() public {
        CHEATS.roll(23198137);

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

        attacker = CHEATS.addr(ATTACKER_KEY);
        someone = newAddr();
        ticketSender = CHEATS.addr(TICKET_SENDER_KEY);
        roundLength = ROUNDS_MANAGER.roundLength();

        // Fund the ticket sender on ticket broker
        payable(ticketSender).transfer(1 ether);
        CHEATS.prank(ticketSender);
        TICKET_BROKER.fundDeposit{ value: 1 ether }();

        /// attacker need 2000 lpt to execute the attack
        CHEATS.startPrank(address(MINTER));
        TOKEN.mint(attacker, 4000 * 1e18 + 2);
        TOKEN.mint(someone, 2000 * 1e18 + 2);
        CHEATS.stopPrank();

        /// ---------------------- ROUND = 3902 ----------------------
        _skipToNextRound(3902);

        /// hacker bond for themself to make their status in the next round become "Bonded"
        CHEATS.startPrank(attacker);
        TOKEN.approve(address(BONDING_MANAGER), type(uint256).max);
        BONDING_MANAGER.bond(1, attacker);
        BONDING_MANAGER.transcoder(1000000, 0);
        CHEATS.stopPrank();

        CHEATS.startPrank(someone);
        TOKEN.approve(address(BONDING_MANAGER), type(uint256).max);
        BONDING_MANAGER.bond(1, someone);
        BONDING_MANAGER.transcoder(1000000, 1000000);
        CHEATS.stopPrank();

        /// ---------------------- ROUND = 3903 ----------------------
        _skipToNextRound(3903);

        // attacker bond more than the last transcoder and kick them out of the `transcoderPool`
        CHEATS.startPrank(attacker);
        BONDING_MANAGER.bond(1200 * 1e18, attacker);
        assertEq(attacker, _getLastTranscoder());
        CHEATS.stopPrank();

        // unbond all but 1 "wei" of LPT to inflate rewards to the maximum
        CHEATS.startPrank(attacker);
        BONDING_MANAGER.unbond(1200 * 1e18);
        assertEq(_getDelegatorData(attacker).delegatedAmount, 1);
        assertEq(attacker, _getLastTranscoder());
        CHEATS.stopPrank();

        /// ---------------------- ROUND = 3904 ----------------------
        _skipToNextRound(3904);

        // someone bond more than the attacker to kick attacker out of the `transcoderPool`
        CHEATS.startPrank(someone);
        BONDING_MANAGER.bond(1200 * 1e18, someone);
        assertEq(someone, _getLastTranscoder());
        CHEATS.stopPrank();

        /// ---------------------- ROUND = 3905 ----------------------
        _skipToNextRound(3905);

        // attacker is inactive in this round
        assertTrue(!BONDING_MANAGER.isActiveTranscoder(attacker));

        uint256 inflateAmount = address(MINTER).balance / ATTACK_GRANULARITY;

        // attacker bond more tokens to themselves, but the lastActiveStakeUpdateRound remain unchange (3904)
        CHEATS.startPrank(attacker);
        BONDING_MANAGER.bond(inflateAmount - 1, attacker);
        CHEATS.stopPrank();

        assertEq(someone, _getLastTranscoder());
        assertEq(_getTranscoderData(attacker).lastActiveStakeUpdateRound, 3904);

        // the delegated amount is bigger than the lastActiveStakeUpdateRound's total stake now
        assertGt(_getDelegatorData(attacker).delegatedAmount, _getTransoderEarningPoolData(attacker, 3641).totalStake);
    }

    function test_feeOverclaimFix() public {
        /// ---------------------- ROUND = 3906 ----------------------
        _skipToNextRound(3906);

        uint256 prevFees = _getDelegatorData(attacker).fees;
        assertEq(prevFees, 0);

        uint256 ticketAmount = ATTACK_GRANULARITY;

        // Sign the winning ticket to the attacker
        (MTicketBrokerCore.Ticket memory ticket, bytes memory signature, uint256 rand) = signWinningTicket(
            ticketSender,
            attacker,
            ticketAmount
        );

        uint256 prevMinterBalance = address(MINTER).balance;

        CHEATS.startPrank(address(attacker));

        CHEATS.expectRevert("transcoder must be active");
        TICKET_BROKER.redeemWinningTicket(ticket, signature, rand);
        CHEATS.stopPrank();

        uint256 receivedFees = _getDelegatorData(attacker).fees;
        console.log("received fees =", receivedFees);
        assertEq(receivedFees, 0);

        uint256 minterBalance = address(MINTER).balance;
        console.log("starting minter balance=", prevMinterBalance, "wei");
        console.log("remaining minter balance=", minterBalance, "wei");
        assertEq(prevMinterBalance, minterBalance);
    }

    function test_feeOverclaimFix_activating_transcoder() public {
        /// ---------------------- ROUND = 3906 ----------------------
        _skipToNextRound(3906);

        // Become active again
        CHEATS.startPrank(attacker);
        BONDING_MANAGER.bond(1500 * 1e18, attacker);
        CHEATS.stopPrank();

        assertEq(attacker, _getLastTranscoder());
        assertTrue(!BONDING_MANAGER.isActiveTranscoder(attacker));

        uint256 prevFees = _getDelegatorData(attacker).fees;
        assertEq(prevFees, 0);

        uint256 ticketAmount = ATTACK_GRANULARITY;

        // Sign the winning ticket to the attacker
        (MTicketBrokerCore.Ticket memory ticket, bytes memory signature, uint256 rand) = signWinningTicket(
            ticketSender,
            attacker,
            ticketAmount
        );

        CHEATS.startPrank(address(attacker));

        CHEATS.expectRevert("transcoder must be active");
        TICKET_BROKER.redeemWinningTicket(ticket, signature, rand);
        CHEATS.stopPrank();

        uint256 receivedFees = _getDelegatorData(attacker).fees;
        console.log("received fees =", receivedFees);
        assertEq(receivedFees, 0);
    }

    function test_feeOverclaimFix_reactivated_transcoder() public {
        /// ---------------------- ROUND = 3906 ----------------------
        _skipToNextRound(3906);

        // Become active again
        CHEATS.startPrank(attacker);
        BONDING_MANAGER.bond(1500 * 1e18, attacker);
        CHEATS.stopPrank();

        assertEq(attacker, _getLastTranscoder());
        assertTrue(!BONDING_MANAGER.isActiveTranscoder(attacker));

        /// ---------------------- ROUND = 3907 ----------------------
        _skipToNextRound(3907);
        assertTrue(BONDING_MANAGER.isActiveTranscoder(attacker));

        uint256 prevFees = _getDelegatorData(attacker).fees;
        assertEq(prevFees, 0);

        uint256 ticketAmount = ATTACK_GRANULARITY;

        // Sign the winning ticket to the attacker
        (MTicketBrokerCore.Ticket memory ticket, bytes memory signature, uint256 rand) = signWinningTicket(
            ticketSender,
            attacker,
            ticketAmount
        );

        uint256 prevMinterBalance = address(MINTER).balance;

        CHEATS.startPrank(address(attacker));

        TICKET_BROKER.redeemWinningTicket(ticket, signature, rand);
        BONDING_MANAGER.claimEarnings(ROUNDS_MANAGER.currentRound());
        uint256 fees = _getDelegatorData(attacker).fees;
        uint256 receivedFees = fees - prevFees;
        BONDING_MANAGER.withdrawFees(payable(attacker), receivedFees);

        CHEATS.stopPrank();

        // Ticket redemption works in this case, but the value should be exactly the ticket amount
        console.log("received fees =", receivedFees);
        assertEq(receivedFees, ticketAmount);

        uint256 minterBalance = address(MINTER).balance;
        console.log("starting minter balance=", prevMinterBalance, "wei");
        console.log("remaining minter balance=", minterBalance, "wei");
        assertEq(prevMinterBalance - minterBalance, ticketAmount);
    }

    receive() external payable {}

    function signWinningTicket(
        address sender,
        address recipient,
        uint256 faceValue
    )
        public
        returns (
            MTicketBrokerCore.Ticket memory ticket,
            bytes memory sig,
            uint256 rand
        )
    {
        // Prepare a always-winning ticket of 1 ETH to the main attacker contract
        ticket = MTicketBrokerCore.Ticket({
            recipient: recipient,
            sender: sender,
            faceValue: faceValue,
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

    /// ------------------ HELPER FUNCTION ------------------

    function _skipToNextRound(uint256 expectedRound) internal {
        CHEATS.roll(block.number + roundLength);
        ROUNDS_MANAGER.initializeRound();

        uint256 currentRound = ROUNDS_MANAGER.currentRound();
        assertEq(currentRound, expectedRound);
        console.log("\n---------------------- ROUND = %s ----------------------", currentRound);
    }

    function _getDelegatorData(address del) internal view returns (DelegatorData memory) {
        return IBondingManagerHelper(address(BONDING_MANAGER)).getDelegator(del);
    }

    function _getTransoderEarningPoolData(address del, uint256 round)
        internal
        view
        returns (TranscoderEarningsPoolData memory)
    {
        return IBondingManagerHelper(address(BONDING_MANAGER)).getTranscoderEarningsPoolForRound(del, round);
    }

    function _getTranscoderData(address del) internal view returns (TranscoderData memory) {
        return IBondingManagerHelper(address(BONDING_MANAGER)).getTranscoder(del);
    }

    function _getTranscoderAtIndex(uint256 index) internal view returns (address lastTranscoder) {
        lastTranscoder = BONDING_MANAGER.getFirstTranscoderInPool();
        for (uint256 i = 1; i < index; ++i) {
            lastTranscoder = BONDING_MANAGER.getNextTranscoderInPool(lastTranscoder);
        }
    }

    function _getLastTranscoder() internal view returns (address lastTranscoder) {
        return _getTranscoderAtIndex(100);
    }
}
