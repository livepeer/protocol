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

// forge test --match-contract BondingVotesStateInitialization --fork-url https://arbitrum-mainnet.infura.io/v3/$INFURA_KEY -vvv --fork-block-number 110930219
contract BondingVotesStateInitialization is GovernorBaseTest {
    address public constant CURRENT_BONDING_MANAGER_TARGET = 0x3a941e1094B9E33efABB26a9047a8ABb4b257907;
    BondingManager public constant BONDING_MANAGER = BondingManager(0x35Bcf3c30594191d53231E4FF333E8A770453e40);
    RoundsManager public constant ROUNDS_MANAGER = RoundsManager(0xdd6f56DcC28D3F5f27084381fE8Df634985cc39f);

    bytes32 public constant BONDING_MANAGER_TARGET_ID = keccak256("BondingManagerTarget");
    bytes32 public constant BONDING_VOTES_ID = keccak256("BondingVotes");
    bytes32 public constant BONDING_VOTES_TARGET_ID = keccak256("BondingVotesTarget");

    // Has a non-null delegate as of fork block
    address public constant DELEGATOR = 0xed89FFb5F4a7460a2F9B894b494db4F5e431f842;
    // Delegate (transcoder) of the above delegator
    address public constant DELEGATOR_DELEGATE = 0xBD677e96a755207D348578727AA57A512C2022Bd;
    // Another independent transcoder as of fork block
    address public constant TRANSCODER = 0x5D98F8d269C94B746A5c3C2946634dCfc75E5E60;
    // Initialized on test setup
    address nonParticipant;
    address[] public _testAddresses;

    BondingManager public newBondingManagerTarget;
    BondingVotes public bondingVotesTarget;
    IBondingVotes public bondingVotes;

    function setUp() public {
        nonParticipant = CHEATS.addr(1);
        _testAddresses = [DELEGATOR_DELEGATE, DELEGATOR, TRANSCODER, nonParticipant];

        newBondingManagerTarget = new BondingManager(address(CONTROLLER));
        bondingVotesTarget = new BondingVotes(address(CONTROLLER));

        ManagerProxy bondingVotesProxy = new ManagerProxy(address(CONTROLLER), BONDING_VOTES_TARGET_ID);
        bondingVotes = IBondingVotes(address(bondingVotesProxy));

        (, gitCommitHash) = CONTROLLER.getContractInfo(BONDING_MANAGER_TARGET_ID);

        stageAndExecuteOne(
            address(CONTROLLER),
            0,
            abi.encodeWithSelector(
                CONTROLLER.setContractInfo.selector,
                BONDING_VOTES_TARGET_ID,
                address(bondingVotesTarget),
                gitCommitHash
            )
        );
        stageAndExecuteOne(
            address(CONTROLLER),
            0,
            abi.encodeWithSelector(
                CONTROLLER.setContractInfo.selector,
                BONDING_VOTES_ID,
                address(bondingVotes),
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

        (infoAddr, infoGitCommitHash) = fetchContractInfo(BONDING_VOTES_TARGET_ID);
        assertEq(infoAddr, address(bondingVotesTarget));
        assertEq(infoGitCommitHash, gitCommitHash);

        (infoAddr, infoGitCommitHash) = fetchContractInfo(BONDING_VOTES_ID);
        assertEq(infoAddr, address(bondingVotes));
        assertEq(infoGitCommitHash, gitCommitHash);
    }

    function testNoAddressHasCheckpoints() public {
        assertEq(_testAddresses.length, 4);

        for (uint256 i = 0; i < _testAddresses.length; i++) {
            assertTrue(!bondingVotes.hasCheckpoint(_testAddresses[i]));
        }
    }

    function testReturnsZeroBalanceForUncheckpointedAccount() public {
        uint256 currentRound = ROUNDS_MANAGER.currentRound();

        for (uint256 i = 0; i < _testAddresses.length; i++) {
            (uint256 checkedAmount, address checkedDelegate) = bondingVotes.getBondingStateAt(
                _testAddresses[i],
                currentRound
            );
            assertEq(checkedAmount, 0);
            assertEq(checkedDelegate, address(0));
        }
    }

    function testInitializesCheckpointState() public {
        uint256 currentRound = ROUNDS_MANAGER.currentRound();

        for (uint256 i = 0; i < _testAddresses.length; i++) {
            address addr = _testAddresses[i];

            BONDING_MANAGER.checkpointBondingState(addr);
            assertTrue(bondingVotes.hasCheckpoint(addr));

            // Still returns zero checkpoint in the current round, checkpoint is made for the next.
            // We don't check delegatedAmount for simplicity here, it is checked in the other tests.
            (, address checkedDelegate) = bondingVotes.getBondingStateAt(addr, currentRound);
            assertEq(checkedDelegate, address(0));

            // Allows querying up to the next round.
            (, checkedDelegate) = bondingVotes.getBondingStateAt(addr, currentRound + 1);
            assertEq(
                checkedDelegate,
                addr == DELEGATOR || addr == DELEGATOR_DELEGATE ? DELEGATOR_DELEGATE : addr == TRANSCODER
                    ? TRANSCODER
                    : address(0)
            );

            // Disallows querying further than the next round though
            CHEATS.expectRevert(
                abi.encodeWithSelector(IBondingVotes.FutureLookup.selector, currentRound + 2, currentRound + 1)
            );
            bondingVotes.getBondingStateAt(addr, currentRound + 2);
        }
    }

    function testAllowsQueryingTranscoderStateOnNextRound() public {
        uint256 currentRound = ROUNDS_MANAGER.currentRound();
        (, , , uint256 delegatedAmount, , , ) = BONDING_MANAGER.getDelegator(TRANSCODER);

        BONDING_MANAGER.checkpointBondingState(TRANSCODER);

        (uint256 checkedAmount, address checkedDelegate) = bondingVotes.getBondingStateAt(TRANSCODER, currentRound + 1);
        assertEq(checkedAmount, delegatedAmount);
        assertEq(checkedDelegate, TRANSCODER);
    }

    function testAllowsQueryingDelegatorStateOnNextRound() public {
        (, , address delegateAddress, , , , ) = BONDING_MANAGER.getDelegator(DELEGATOR);
        assertEq(delegateAddress, DELEGATOR_DELEGATE);

        uint256 currentRound = ROUNDS_MANAGER.currentRound();
        uint256 pendingStake = BONDING_MANAGER.pendingStake(DELEGATOR, currentRound);

        BONDING_MANAGER.checkpointBondingState(DELEGATOR);
        // the delegate also needs to be checkpointed in case of delegators
        BONDING_MANAGER.checkpointBondingState(DELEGATOR_DELEGATE);

        (uint256 checkedAmount, address checkedDelegate) = bondingVotes.getBondingStateAt(DELEGATOR, currentRound + 1);

        assertEq(checkedAmount, pendingStake);
        assertEq(checkedDelegate, DELEGATOR_DELEGATE);
    }

    function testDoesNotHaveTotalActiveStakeImmediately() public {
        uint256 currentRound = ROUNDS_MANAGER.currentRound();

        assertEq(bondingVotes.getTotalActiveStakeAt(currentRound), 0);
    }

    function testReturnsZeroTotalActiveStakeIfNoCheckpointsMade() public {
        uint256 currentRound = ROUNDS_MANAGER.currentRound();
        assertEq(bondingVotes.getTotalActiveStakeAt(currentRound), 0);
    }

    function testReturnsNextRoundTotalActiveStakeIfAfterLastCheckpoint() public {
        uint256 currentRound = ROUNDS_MANAGER.currentRound();

        uint256 nextRoundStartBlock = ROUNDS_MANAGER.currentRoundStartBlock() + ROUNDS_MANAGER.roundLength();
        CHEATS.roll(nextRoundStartBlock);
        ROUNDS_MANAGER.initializeRound();

        CHEATS.roll(nextRoundStartBlock + 2 * ROUNDS_MANAGER.roundLength());
        assertEq(ROUNDS_MANAGER.currentRound(), currentRound + 3);

        uint256 expected = BONDING_MANAGER.nextRoundTotalActiveStake();
        assertEq(bondingVotes.getTotalActiveStakeAt(currentRound + 2), expected);
        assertEq(bondingVotes.getTotalActiveStakeAt(currentRound + 3), expected);
    }

    function testDoesNotUseFutureCheckpointForTotalActiveStake() public {
        uint256 currentRound = ROUNDS_MANAGER.currentRound();

        uint256 nextRoundStartBlock = ROUNDS_MANAGER.currentRoundStartBlock() + ROUNDS_MANAGER.roundLength();
        CHEATS.roll(nextRoundStartBlock);
        ROUNDS_MANAGER.initializeRound();
        assertEq(ROUNDS_MANAGER.currentRound(), currentRound + 1);

        assertEq(bondingVotes.getTotalActiveStakeAt(currentRound), 0);
    }

    function testUsesNextRoundTotalActiveStakeForCurrentRounds() public {
        uint256 currentRound = ROUNDS_MANAGER.currentRound();

        uint256 nextRoundStartBlock = ROUNDS_MANAGER.currentRoundStartBlock() + ROUNDS_MANAGER.roundLength();
        CHEATS.roll(nextRoundStartBlock);
        ROUNDS_MANAGER.initializeRound();

        nextRoundStartBlock = ROUNDS_MANAGER.currentRoundStartBlock() + ROUNDS_MANAGER.roundLength();
        CHEATS.roll(nextRoundStartBlock);
        assertEq(ROUNDS_MANAGER.currentRound(), currentRound + 2);

        uint256 expected = BONDING_MANAGER.nextRoundTotalActiveStake();
        assertEq(bondingVotes.getTotalActiveStakeAt(currentRound + 2), expected);
        // should work up to the next round as well
        assertEq(bondingVotes.getTotalActiveStakeAt(currentRound + 3), expected);
    }

    function testCheckpointsTotalActiveStakeOnInitializeRound() public {
        uint256 currentRound = ROUNDS_MANAGER.currentRound();

        uint256 nextRoundStartBlock = ROUNDS_MANAGER.currentRoundStartBlock() + ROUNDS_MANAGER.roundLength();
        CHEATS.roll(nextRoundStartBlock);
        ROUNDS_MANAGER.initializeRound();
        assertEq(ROUNDS_MANAGER.currentRound(), currentRound + 1);

        uint256 totalBonded = BONDING_MANAGER.getTotalBonded();

        uint256 totalAcctiveStakeChk = bondingVotes.getTotalActiveStakeAt(currentRound + 1);
        assertEq(totalAcctiveStakeChk, totalBonded);
    }
}
