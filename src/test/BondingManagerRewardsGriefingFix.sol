pragma solidity ^0.8.9;

import "ds-test/test.sol";
import "./base/GovernorBaseTest.sol";
import "contracts/ManagerProxy.sol";
import "contracts/bonding/BondingManager.sol";
import "contracts/bonding/BondingVotes.sol";
import "contracts/rounds/RoundsManager.sol";
import "contracts/token/LivepeerToken.sol";
import "contracts/snapshots/MerkleSnapshot.sol";
import "./interfaces/ICheatCodes.sol";
import "./interfaces/IL2Migrator.sol";

// forge test --match-contract BondingManagerRewardsGriefingFix --fork-url https://arbitrum-mainnet.infura.io/v3/$INFURA_KEY -vvv --fork-block-number 190718920
contract BondingManagerRewardsGriefingFix is GovernorBaseTest {
    BondingManager public constant BONDING_MANAGER = BondingManager(0x35Bcf3c30594191d53231E4FF333E8A770453e40);
    RoundsManager public constant ROUNDS_MANAGER = RoundsManager(0xdd6f56DcC28D3F5f27084381fE8Df634985cc39f);
    LivepeerToken public constant TOKEN = LivepeerToken(0x289ba1701C2F088cf0faf8B3705246331cB8A839);
    address public constant MINTER = 0xc20DE37170B45774e6CD3d2304017fc962f27252;

    bytes32 public constant BONDING_MANAGER_TARGET_ID = keccak256("BondingManagerTarget");

    // Has a non-null delegate as of fork block
    address public constant DELEGATOR = 0xed89FFb5F4a7460a2F9B894b494db4F5e431f842;
    uint256 public constant DELEGATOR_BOND = 192918435343427499201;

    // Delegate (transcoder) of the above delegator
    address public constant TRANSCODER = 0xBD677e96a755207D348578727AA57A512C2022Bd;

    address public attacker;

    BondingManager public newBondingManagerTarget;

    function setUp() public {
        newBondingManagerTarget = new BondingManager(address(CONTROLLER));
        (, bytes20 gitCommitHash) = CONTROLLER.getContractInfo(BONDING_MANAGER_TARGET_ID);
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

        attacker = CHEATS.addr(1);

        uint256 mockAllow = 1000;

        CHEATS.prank(MINTER);
        TOKEN.mint(attacker, mockAllow);

        CHEATS.prank(attacker);
        TOKEN.approve(address(BONDING_MANAGER), mockAllow);

        nextRound();
    }

    function testUpgrade() public {
        (, bytes20 gitCommitHash) = CONTROLLER.getContractInfo(BONDING_MANAGER_TARGET_ID);

        // Check that new BondingManagerTarget is registered
        (address infoAddr, bytes20 infoGitCommitHash) = fetchContractInfo(BONDING_MANAGER_TARGET_ID);
        assertEq(infoAddr, address(newBondingManagerTarget));
        assertEq(infoGitCommitHash, gitCommitHash);
    }

    function testAllowsBondAfterReward() public {
        CHEATS.prank(TRANSCODER);
        BONDING_MANAGER.reward();

        uint256 cost = 1;
        CHEATS.prank(attacker);
        BONDING_MANAGER.bondForWithHint(cost, DELEGATOR, TRANSCODER, address(0), address(0), address(0), address(0));

        assertTrue(BONDING_MANAGER.pendingStake(DELEGATOR, 0) > DELEGATOR_BOND + cost);
    }

    function testDisallowsBondBeforeReward() public {
        uint256 cost = 1;
        CHEATS.prank(attacker);
        CHEATS.expectRevert(bytes("ILLEGAL_CLAIM_EARNINGS"));
        BONDING_MANAGER.bondForWithHint(cost, DELEGATOR, TRANSCODER, address(0), address(0), address(0), address(0));
    }

    function testDisallowsTransferBondBeforeReward() public {
        uint256 cost = 1;
        CHEATS.prank(attacker);
        BONDING_MANAGER.bond(cost, TRANSCODER);
        nextRound();

        CHEATS.prank(attacker);
        CHEATS.expectRevert(bytes("ILLEGAL_CLAIM_EARNINGS"));
        BONDING_MANAGER.transferBond(DELEGATOR, cost, address(0), address(0), address(0), address(0));
    }

    function nextRound() private {
        uint256 nextRoundStartBlock = ROUNDS_MANAGER.currentRoundStartBlock() + ROUNDS_MANAGER.roundLength();
        CHEATS.roll(nextRoundStartBlock);
        ROUNDS_MANAGER.initializeRound();
    }
}
