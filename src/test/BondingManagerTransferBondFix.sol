pragma solidity ^0.8.9;

import "ds-test/test.sol";
import "./base/GovernorBaseTest.sol";
import "contracts/bonding/BondingManager.sol";
import "contracts/snapshots/MerkleSnapshot.sol";
import "./interfaces/IL2Migrator.sol";
import "./interfaces/ICheatCodes.sol";

// forge test -vvv --fork-url <ARB_MAINNET_RPC_URL> --fork-block-number 6737758 --match-contract BondingManagerTransferBondFix
contract BondingManagerTransferBondFix is GovernorBaseTest {
    BondingManager public constant BONDING_MANAGER = BondingManager(0x35Bcf3c30594191d53231E4FF333E8A770453e40);
    MerkleSnapshot public constant MERKLE_SNAPSHOT = MerkleSnapshot(0x10736ffaCe687658F88a46D042631d182C7757f7);
    IL2Migrator public constant L2_MIGRATOR = IL2Migrator(0x148D5b6B4df9530c7C76A810bd1Cdf69EC4c2085);

    bytes32 public constant BONDING_MANAGER_TARGET_ID = keccak256("BondingManagerTarget");

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
    }

    function testTransferBond() public {
        CHEATS.mockCall(
            address(MERKLE_SNAPSHOT),
            abi.encodeWithSelector(MERKLE_SNAPSHOT.verify.selector),
            abi.encode(true)
        );

        uint256 round = 2476;
        uint256 blockNum = round * 5760;
        CHEATS.roll(blockNum);

        address delegator = 0xcd8148C45ABFF4b3F01faE5aD31bC96AD6425054;
        bytes32[] memory proof;
        CHEATS.prank(delegator);
        L2_MIGRATOR.claimStake(
            0x525419FF5707190389bfb5C87c375D710F5fCb0E,
            11787420136760339363,
            99994598814723,
            proof,
            address(0)
        );

        (uint256 bondedAmount, , , , , uint256 lastClaimRound, ) = BONDING_MANAGER.getDelegator(delegator);
        uint256 pendingStake = BONDING_MANAGER.pendingStake(delegator, 0);
        uint256 pendingFees = BONDING_MANAGER.pendingFees(delegator, 0);

        assertEq(pendingStake, bondedAmount);
        assertEq(pendingFees, 0);
        assertEq(lastClaimRound, round);
    }

    function testUpgrade() public {
        (, bytes20 gitCommitHash) = CONTROLLER.getContractInfo(BONDING_MANAGER_TARGET_ID);

        // Check that new BondingManagerTarget is registered
        (address infoAddr, bytes20 infoGitCommitHash) = fetchContractInfo(BONDING_MANAGER_TARGET_ID);
        assertEq(infoAddr, address(newBondingManagerTarget));
        assertEq(infoGitCommitHash, gitCommitHash);
    }
}
