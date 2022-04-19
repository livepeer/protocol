pragma solidity ^0.8.9;

import "ds-test/test.sol";
import "./base/GovernorBaseTest.sol";
import "contracts/bonding/BondingManager.sol";
import "contracts/snapshots/MerkleSnapshot.sol";
import "./interfaces/IL2Migrator.sol";

// forge test -vvv --fork-url <ARB_MAINNET_RPC_URL> --fork-block-number 6768454 --match-contract BondingManagerNullDelegateTransferBondFix
contract BondingManagerNullDelegateTransferBondFix is GovernorBaseTest {
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

    function testUpgrade() public {
        (, bytes20 gitCommitHash) = CONTROLLER.getContractInfo(BONDING_MANAGER_TARGET_ID);

        // Check that new BondingManagerTarget is registered
        (address infoAddr, bytes20 infoGitCommitHash) = fetchContractInfo(BONDING_MANAGER_TARGET_ID);
        assertEq(infoAddr, address(newBondingManagerTarget));
        assertEq(infoGitCommitHash, gitCommitHash);
    }

    function testTransferBond() public {
        CHEATS.mockCall(
            address(MERKLE_SNAPSHOT),
            abi.encodeWithSelector(MERKLE_SNAPSHOT.verify.selector),
            abi.encode(true)
        );

        // This test should be run with --fork-block-number 6768454
        // We are forking right before https://arbiscan.io/address/0xF8E893C7D84E366f7Bc6bc1cdB568Ff8c91bCF57
        // This is the corresponding L1 block number
        CHEATS.roll(14265594);

        address delegator = 0xF8E893C7D84E366f7Bc6bc1cdB568Ff8c91bCF57;
        address delegate = 0x5bE44e23041E93CDF9bCd5A0968524e104e38ae1;
        bytes32[] memory proof;
        CHEATS.prank(delegator);
        L2_MIGRATOR.claimStake(delegate, 500000000000000000000, 0, proof, address(0));

        (, , address delegateAddress, , , , ) = BONDING_MANAGER.getDelegator(delegator);

        assertEq(delegateAddress, delegate);
    }
}
