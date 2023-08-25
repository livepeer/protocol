pragma solidity ^0.8.9;

import "ds-test/test.sol";
import "./base/GovernorBaseTest.sol";
import "contracts/bonding/BondingManager.sol";
import "contracts/rounds/RoundsManager.sol";
import "contracts/token/LivepeerToken.sol";
import "contracts/snapshots/MerkleSnapshot.sol";
import "./interfaces/ICheatCodes.sol";
import "./interfaces/IL2Migrator.sol";

// forge test --match-contract BondingManagerForceSelfDelegationFix --fork-url https://arbitrum-mainnet.infura.io/v3/<INFURA_KEY> -vvv --fork-block-number 104182839
contract BondingManagerForceSelfDelegationFix is GovernorBaseTest {
    BondingManager public constant BONDING_MANAGER = BondingManager(0x35Bcf3c30594191d53231E4FF333E8A770453e40);
    MerkleSnapshot public constant MERKLE_SNAPSHOT = MerkleSnapshot(0x10736ffaCe687658F88a46D042631d182C7757f7);
    IL2Migrator public constant L2_MIGRATOR = IL2Migrator(0x148D5b6B4df9530c7C76A810bd1Cdf69EC4c2085);
    RoundsManager public constant ROUNDS_MANAGER = RoundsManager(0xdd6f56DcC28D3F5f27084381fE8Df634985cc39f);
    LivepeerToken public constant TOKEN = LivepeerToken(0x289ba1701C2F088cf0faf8B3705246331cB8A839);

    address public constant MINTER = 0xc20DE37170B45774e6CD3d2304017fc962f27252;
    address public constant L1_MIGRATOR = 0x21146B872D3A95d2cF9afeD03eE5a783DaE9A89A;

    bytes32 public constant BONDING_MANAGER_TARGET_ID = keccak256("BondingManagerTarget");

    BondingManager public newBondingManagerTarget;

    event Bond(
        address indexed newDelegate,
        address indexed oldDelegate,
        address indexed delegator,
        uint256 additionalAmount,
        uint256 bondedAmount
    );

    uint160 internal constant OFFSET = uint160(0x1111000000000000000000000000000000001111);

    function applyL1ToL2Alias(address _l1Address) internal pure returns (address l2Address) {
        l2Address = address(uint160(_l1Address) + OFFSET);
    }

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
    }

    function testUpgrade() public {
        // Check that new BondingManagerTarget is registered
        (address infoAddr, bytes20 infoGitCommitHash) = fetchContractInfo(BONDING_MANAGER_TARGET_ID);
        assertEq(infoAddr, address(newBondingManagerTarget));
        assertEq(infoGitCommitHash, gitCommitHash);
    }

    // A bondForWithHint() call from a third party that sets an unbonded delegator's delegate to self should fail after the upgrade
    function testThirdPartyBondForWithHintInvalidDelegate() public {
        address thirdParty = CHEATS.addr(1);
        address delegator = CHEATS.addr(2);

        CHEATS.prank(thirdParty);
        CHEATS.expectRevert("INVALID_DELEGATE");
        BONDING_MANAGER.bondForWithHint(1, delegator, delegator, address(0), address(0), address(0), address(0));
    }

    // A bondForWithHint() call from a third party that changes a delegator's non-null delegate should fail after the upgrade
    function testThirdPartyBondForWithHintInvalidDelegateChange() public {
        address thirdParty = CHEATS.addr(1);
        // Has a non-null delegate as of fork block
        address delegator = 0xed89FFb5F4a7460a2F9B894b494db4F5e431f842;
        // Is a transcoder as of fork block
        address transcoder = 0x5D98F8d269C94B746A5c3C2946634dCfc75E5E60;

        CHEATS.prank(thirdParty);
        CHEATS.expectRevert("INVALID_DELEGATE_CHANGE");
        BONDING_MANAGER.bondForWithHint(0, delegator, transcoder, address(0), address(0), address(0), address(0));
    }

    // A transferBond() call that setes an unbonded delegator's delegate to self should fail after the upgrade
    function testTransferBondInvalidDelegator() public {
        address sender = CHEATS.addr(1);
        address receiver = CHEATS.addr(2);

        uint256 mockAllow = 1000;

        CHEATS.startPrank(MINTER);
        TOKEN.mint(sender, mockAllow);

        CHEATS.startPrank(sender);
        TOKEN.approve(address(BONDING_MANAGER), mockAllow);
        BONDING_MANAGER.bond(1, receiver);
        CHEATS.stopPrank();

        // Sender needs to wait 1 round before it can call transferBond()
        // This is the next round start block assuming 104182839 is the fork block number
        uint256 nextRoundStartBlock = 17545330;
        CHEATS.roll(nextRoundStartBlock);
        ROUNDS_MANAGER.initializeRound();

        CHEATS.prank(sender);
        CHEATS.expectRevert("INVALID_DELEGATOR");
        BONDING_MANAGER.transferBond(receiver, 1, address(0), address(0), address(0), address(0));
    }

    // A bondForWithHint() call from L2Migrator.finalizeMigrateDelegator() to set a migrating transcoder's delegate to self
    // should still succeed after the upgrade
    function testTranscoderFinalizeMigrateDelegator() public {
        address transcoder = CHEATS.addr(1);
        address l1MigratorL2Alias = applyL1ToL2Alias(L1_MIGRATOR);

        uint256 stake = 500000000000000000000;
        uint256 delegatedStake = 1000000000000000000000;
        IL2Migrator.MigrateDelegatorParams memory params = IL2Migrator.MigrateDelegatorParams({
            l1Addr: transcoder,
            l2Addr: transcoder,
            stake: stake,
            delegatedStake: delegatedStake,
            fees: 0,
            delegate: transcoder
        });

        CHEATS.prank(l1MigratorL2Alias);
        CHEATS.expectEmit(true, true, true, true);
        emit Bond(transcoder, address(0), transcoder, stake, stake);
        L2_MIGRATOR.finalizeMigrateDelegator(params);

        (uint256 bondedAmount, , address delegateAddress, uint256 delegatedAmount, , , ) = BONDING_MANAGER.getDelegator(
            transcoder
        );
        assertEq(bondedAmount, stake);
        assertEq(delegateAddress, transcoder);
        assertEq(delegatedAmount, delegatedStake);
        assertTrue(BONDING_MANAGER.isRegisteredTranscoder(transcoder));
    }

    // A bondForWithHint() call from L2Migrator.claimStake() to set a migrating delegator's delegate to a transcoder
    // should still succeed after the upgrade
    function testDelegatorClaimStake() public {
        address delegator = CHEATS.addr(1);
        address delegate = CHEATS.addr(2);

        // Allow arbitrary proof to pass verification in L2Migrator.claimStake()
        CHEATS.mockCall(
            address(MERKLE_SNAPSHOT),
            abi.encodeWithSelector(MERKLE_SNAPSHOT.verify.selector),
            abi.encode(true)
        );

        uint256 stake = 500000000000000000000;
        bytes32[] memory proof;

        CHEATS.prank(delegator);
        CHEATS.expectEmit(true, true, true, true);
        emit Bond(delegate, address(0), delegator, stake, stake);
        L2_MIGRATOR.claimStake(delegate, stake, 0, proof, address(0));

        (uint256 bondedAmount, , address delegateAddress, , , , ) = BONDING_MANAGER.getDelegator(delegator);
        assertEq(bondedAmount, stake);
        assertEq(delegateAddress, delegate);
    }
}
