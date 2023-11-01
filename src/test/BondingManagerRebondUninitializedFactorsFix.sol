pragma solidity ^0.8.9;

import "ds-test/test.sol";
import "forge-std/console.sol";
import "./base/GovernorBaseTest.sol";
import "contracts/bonding/BondingManager.sol";
import "contracts/rounds/RoundsManager.sol";
import "contracts/token/LivepeerToken.sol";

// forge test -vvv --fork-url <ARB_MAINNET_RPC_URL> --match-contract BondingManagerRebondUninitializedFactorsFix --fork-block-number 145827633
contract BondingManagerRebondUninitializedFactorsFix is GovernorBaseTest {
    BondingManager public constant BONDING_MANAGER = BondingManager(0x35Bcf3c30594191d53231E4FF333E8A770453e40);
    RoundsManager public constant ROUNDS_MANAGER = RoundsManager(0xdd6f56DcC28D3F5f27084381fE8Df634985cc39f);
    LivepeerToken public constant TOKEN = LivepeerToken(0x289ba1701C2F088cf0faf8B3705246331cB8A839);

    address public constant TREASURY = 0xf82C1FF415F1fCf582554fDba790E27019c8E8C4;
    bytes32 public constant BONDING_MANAGER_TARGET_ID = keccak256("BondingManagerTarget");

    address public attacker;
    // Active and lastRewardRound = 3160
    // address public transcoder = 0x525419FF5707190389bfb5C87c375D710F5fCb0E;
    // Active and lastRewardRound = 3160
    // address public transcoder = 0x6CB1Ce2516FB7d211038420a8Cf9a843c7bD3B08;
    // Inactive and lastRewardRound = 3108
    address public transcoder = 0x76A65814b6e0fa5a3598Ef6503FA1D990ec0E61A;

    uint256 public initialBondedAmount = 20_000 ether;

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

        // Setup accounts
        attacker = newAddr();

        CHEATS.prank(TREASURY);
        TOKEN.transfer(attacker, initialBondedAmount);

        CHEATS.prank(attacker);
        TOKEN.approve(address(BONDING_MANAGER), initialBondedAmount);
    }

    function testUpgrade() public {
        // Check that new BondingManagerTarget is registered
        (address infoAddr, bytes20 infoGitCommitHash) = fetchContractInfo(BONDING_MANAGER_TARGET_ID);
        assertEq(infoAddr, address(newBondingManagerTarget));
        assertEq(infoGitCommitHash, gitCommitHash);
    }

    function testRebondFromUnbonded() public {
        CHEATS.prank(attacker);
        BONDING_MANAGER.bond(initialBondedAmount, attacker);

        nextRound();

        console.log(
            "Attacker pending stake (before unbond + rebondFromUnbonded): ",
            BONDING_MANAGER.pendingStake(attacker, 0)
        );

        CHEATS.startPrank(attacker);
        BONDING_MANAGER.unbond(initialBondedAmount);
        BONDING_MANAGER.rebondFromUnbonded(transcoder, 0);
        CHEATS.stopPrank();

        nextRound();

        console.log(
            "Attacker pending stake (after unbond + rebondFromUnbonded and new round): ",
            BONDING_MANAGER.pendingStake(attacker, 0)
        );

        CHEATS.prank(attacker);
        BONDING_MANAGER.claimEarnings(0);

        (uint256 endBondedAmount, , , , , , ) = BONDING_MANAGER.getDelegator(attacker);

        assertEq(endBondedAmount, initialBondedAmount);
        console.log("Attacker end bonded amount: ", endBondedAmount);
    }

    function nextRound() public {
        console.log("Current round (before roll): ", ROUNDS_MANAGER.currentRound());

        uint256 currentRoundStartBlock = ROUNDS_MANAGER.currentRoundStartBlock();
        uint256 roundLength = ROUNDS_MANAGER.roundLength();
        CHEATS.roll(currentRoundStartBlock + roundLength);

        ROUNDS_MANAGER.initializeRound();

        console.log("Current round (after roll): ", ROUNDS_MANAGER.currentRound());
    }
}
