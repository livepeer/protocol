pragma solidity ^0.8.9;

import "ds-test/test.sol";
import "./base/GovernorBaseTest.sol";
import "contracts/ManagerProxy.sol";
import "contracts/bonding/BondingManager.sol";
import "contracts/bonding/BondingCheckpoints.sol";
import "contracts/rounds/RoundsManager.sol";
import "contracts/token/LivepeerToken.sol";
import "contracts/snapshots/MerkleSnapshot.sol";
import "./interfaces/ICheatCodes.sol";
import "./interfaces/IL2Migrator.sol";

// forge test --match-contract BondingCheckpointsStateInitialization --fork-url https://arbitrum-mainnet.infura.io/v3/$INFURA_KEY -vvv --fork-block-number 110930219
contract BondingCheckpointsStateInitialization is GovernorBaseTest {
    BondingManager public constant BONDING_MANAGER = BondingManager(0x35Bcf3c30594191d53231E4FF333E8A770453e40);
    RoundsManager public constant ROUNDS_MANAGER = RoundsManager(0xdd6f56DcC28D3F5f27084381fE8Df634985cc39f);

    bytes32 public constant BONDING_MANAGER_TARGET_ID = keccak256("BondingManagerTarget");
    bytes32 public constant BONDING_CHECKPOINTS_ID = keccak256("BondingCheckpoints");
    bytes32 public constant BONDING_CHECKPOINTS_TARGET_ID = keccak256("BondingCheckpointsTarget");

    // Has a non-null delegate as of fork block
    address public constant DELEGATOR = 0xed89FFb5F4a7460a2F9B894b494db4F5e431f842;
    // Is a transcoder as of fork block
    address public constant TRANSCODER = 0x5D98F8d269C94B746A5c3C2946634dCfc75E5E60;
    // Initialized on test setup
    address[] public _testAddresses;

    BondingManager public newBondingManagerTarget;
    BondingCheckpoints public bondingCheckpointsTarget;
    IBondingCheckpoints public bondingCheckpoints;

    function setUp() public {
        address nonParticipant = CHEATS.addr(1);
        _testAddresses = [DELEGATOR, TRANSCODER, nonParticipant];

        newBondingManagerTarget = new BondingManager(address(CONTROLLER));
        bondingCheckpointsTarget = new BondingCheckpoints(address(CONTROLLER));

        ManagerProxy bondingCheckpointsProxy = new ManagerProxy(address(CONTROLLER), BONDING_CHECKPOINTS_TARGET_ID);
        bondingCheckpoints = IBondingCheckpoints(address(bondingCheckpointsProxy));

        (, gitCommitHash) = CONTROLLER.getContractInfo(BONDING_MANAGER_TARGET_ID);

        stageAndExecuteOne(
            address(CONTROLLER),
            0,
            abi.encodeWithSelector(
                CONTROLLER.setContractInfo.selector,
                BONDING_CHECKPOINTS_TARGET_ID,
                address(bondingCheckpointsTarget),
                gitCommitHash
            )
        );
        stageAndExecuteOne(
            address(CONTROLLER),
            0,
            abi.encodeWithSelector(
                CONTROLLER.setContractInfo.selector,
                BONDING_CHECKPOINTS_ID,
                address(bondingCheckpoints),
                gitCommitHash
            )
        );

        // BondingManager deployed last since it depends on checkpoints to be there
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

    function testDeploy() public {
        // Check that new contracts are registered
        (address infoAddr, bytes20 infoGitCommitHash) = fetchContractInfo(BONDING_MANAGER_TARGET_ID);
        assertEq(infoAddr, address(newBondingManagerTarget));
        assertEq(infoGitCommitHash, gitCommitHash);

        (infoAddr, infoGitCommitHash) = fetchContractInfo(BONDING_CHECKPOINTS_TARGET_ID);
        assertEq(infoAddr, address(bondingCheckpointsTarget));
        assertEq(infoGitCommitHash, gitCommitHash);

        (infoAddr, infoGitCommitHash) = fetchContractInfo(BONDING_CHECKPOINTS_ID);
        assertEq(infoAddr, address(bondingCheckpoints));
        assertEq(infoGitCommitHash, gitCommitHash);
    }

    function testNoAddressHasCheckpoints() public {
        assertEq(_testAddresses.length, 3);

        for (uint256 i = 0; i < _testAddresses.length; i++) {
            assertTrue(!bondingCheckpoints.hasCheckpoint(_testAddresses[i]));
        }
    }

    function testDisallowsQueryingEmptyState() public {
        uint256 currentRound = ROUNDS_MANAGER.currentRound();

        for (uint256 i = 0; i < _testAddresses.length; i++) {
            CHEATS.expectRevert(IBondingCheckpoints.NoRecordedCheckpoints.selector);
            bondingCheckpoints.getBondingStateAt(_testAddresses[i], currentRound);
        }
    }

    function testInitializesCheckpointState() public {
        uint256 currentRound = ROUNDS_MANAGER.currentRound();

        for (uint256 i = 0; i < _testAddresses.length; i++) {
            address addr = _testAddresses[i];

            BONDING_MANAGER.checkpointBondingState(addr);
            assertTrue(bondingCheckpoints.hasCheckpoint(addr));

            // Still doesn't allow lookup in the current round, that comes next.
            CHEATS.expectRevert(
                abi.encodeWithSelector(IBondingCheckpoints.PastLookup.selector, currentRound, currentRound + 1)
            );
            bondingCheckpoints.getBondingStateAt(addr, currentRound);

            CHEATS.expectRevert(
                abi.encodeWithSelector(IBondingCheckpoints.FutureLookup.selector, currentRound + 1, currentRound)
            );
            bondingCheckpoints.getBondingStateAt(addr, currentRound + 1);
        }
    }

    function testAllowsQueryingTranscoderStateOnNextRound() public {
        uint256 currentRound = ROUNDS_MANAGER.currentRound();
        (, , , uint256 delegatedAmount, , , ) = BONDING_MANAGER.getDelegator(TRANSCODER);

        BONDING_MANAGER.checkpointBondingState(TRANSCODER);

        // Need to wait 1 round before we can query for the checkpointed state
        uint256 nextRoundStartBlock = ROUNDS_MANAGER.currentRoundStartBlock() + ROUNDS_MANAGER.roundLength();
        CHEATS.roll(nextRoundStartBlock);
        assertEq(ROUNDS_MANAGER.currentRound(), currentRound + 1);

        (uint256 checkedAmount, address checkedDelegate) = bondingCheckpoints.getBondingStateAt(
            TRANSCODER,
            currentRound + 1
        );
        assertEq(checkedAmount, delegatedAmount);
        assertEq(checkedDelegate, TRANSCODER);
    }

    function testAllowsQueryingDelegatorStateOnNextRound() public {
        uint256 currentRound = ROUNDS_MANAGER.currentRound();
        (, , address delegateAddress, , , , ) = BONDING_MANAGER.getDelegator(DELEGATOR);
        uint256 pendingStake = BONDING_MANAGER.pendingStake(DELEGATOR, currentRound + 1);

        BONDING_MANAGER.checkpointBondingState(DELEGATOR);
        // the delegate also needs to be checkpointed in case of delegators
        BONDING_MANAGER.checkpointBondingState(delegateAddress);

        // Need to wait 1 round before we can query for the checkpointed state
        uint256 nextRoundStartBlock = ROUNDS_MANAGER.currentRoundStartBlock() + ROUNDS_MANAGER.roundLength();
        CHEATS.roll(nextRoundStartBlock);
        assertEq(ROUNDS_MANAGER.currentRound(), currentRound + 1);

        (uint256 checkedAmount, address checkedDelegate) = bondingCheckpoints.getBondingStateAt(
            DELEGATOR,
            currentRound + 1
        );

        assertEq(checkedAmount, pendingStake);
        assertEq(checkedDelegate, delegateAddress);
    }

    function testDoesNotHaveTotalActiveStakeImmediately() public {
        uint256 currentRound = ROUNDS_MANAGER.currentRound();

        CHEATS.expectRevert(IBondingCheckpoints.NoRecordedCheckpoints.selector);
        bondingCheckpoints.getTotalActiveStakeAt(currentRound);
    }

    function testDoesNotHaveTotalActiveStakeIfRoundNotInitialized() public {
        uint256 currentRound = ROUNDS_MANAGER.currentRound();

        uint256 nextRoundStartBlock = ROUNDS_MANAGER.currentRoundStartBlock() + ROUNDS_MANAGER.roundLength();
        CHEATS.roll(nextRoundStartBlock);
        assertEq(ROUNDS_MANAGER.currentRound(), currentRound + 1);

        CHEATS.expectRevert(IBondingCheckpoints.NoRecordedCheckpoints.selector);
        bondingCheckpoints.getTotalActiveStakeAt(currentRound + 1);
    }

    function testDoesNotUsePastCheckpointForTotalActiveStake() public {
        uint256 currentRound = ROUNDS_MANAGER.currentRound();

        uint256 nextRoundStartBlock = ROUNDS_MANAGER.currentRoundStartBlock() + ROUNDS_MANAGER.roundLength();
        CHEATS.roll(nextRoundStartBlock);
        ROUNDS_MANAGER.initializeRound();

        nextRoundStartBlock = ROUNDS_MANAGER.currentRoundStartBlock() + ROUNDS_MANAGER.roundLength();
        CHEATS.roll(nextRoundStartBlock);
        assertEq(ROUNDS_MANAGER.currentRound(), currentRound + 2);

        CHEATS.expectRevert(
            abi.encodeWithSelector(IBondingCheckpoints.MissingRoundCheckpoint.selector, currentRound + 2)
        );
        bondingCheckpoints.getTotalActiveStakeAt(currentRound + 2);
    }

    function testCheckpointsTotalActiveStakeOnInitializeRound() public {
        uint256 currentRound = ROUNDS_MANAGER.currentRound();

        uint256 nextRoundStartBlock = ROUNDS_MANAGER.currentRoundStartBlock() + ROUNDS_MANAGER.roundLength();
        CHEATS.roll(nextRoundStartBlock);
        ROUNDS_MANAGER.initializeRound();
        assertEq(ROUNDS_MANAGER.currentRound(), currentRound + 1);

        uint256 totalBonded = BONDING_MANAGER.getTotalBonded();

        uint256 totalAcctiveStakeChk = bondingCheckpoints.getTotalActiveStakeAt(currentRound + 1);
        assertEq(totalAcctiveStakeChk, totalBonded);
    }
}
