pragma solidity ^0.8.9;

import "ds-test/test.sol";
import "./base/GovernorUpgrade.sol";
import "contracts/bonding/BondingManager.sol";
import "contracts/snapshots/MerkleSnapshot.sol";

// forge test -vvv --fork-url <ARB_MAINNET_RPC_URL> --fork-block-number 6768456 --match-contract BondingManagerNullDelegateBondFix
contract BondingManagerNullDelegateBondFix is GovernorUpgrade {
    BondingManager public constant BONDING_MANAGER = BondingManager(0x35Bcf3c30594191d53231E4FF333E8A770453e40);

    bytes32 public constant BONDING_MANAGER_TARGET_ID = keccak256("BondingManagerTarget");

    BondingManager public newBondingManagerTarget;

    function setUp() public {
        newBondingManagerTarget = new BondingManager(address(CONTROLLER));

        targets = [address(CONTROLLER)];
        values = [0];

        (, bytes20 gitCommitHash) = fetchContractInfo(BONDING_MANAGER_TARGET_ID);
        data = [
            abi.encodeWithSelector(
                CONTROLLER.setContractInfo.selector,
                BONDING_MANAGER_TARGET_ID,
                address(newBondingManagerTarget),
                gitCommitHash
            )
        ];
    }

    function testUpgrade() public {
        (, bytes20 gitCommitHash) = fetchContractInfo(BONDING_MANAGER_TARGET_ID);

        upgrade();

        // Check that new BondingManagerTarget is registered
        (address infoAddr, bytes20 infoGitCommitHash) = fetchContractInfo(BONDING_MANAGER_TARGET_ID);
        assertEq(infoAddr, address(newBondingManagerTarget));
        assertEq(infoGitCommitHash, gitCommitHash);
    }

    function testNullDelegateBond() public {
        // This test should be run with --fork-block-number 6768456
        // We are forking right after https://arbiscan.io/address/0xF8E893C7D84E366f7Bc6bc1cdB568Ff8c91bCF57
        // This is the corresponding L1 block number
        CHEATS.roll(14265594);

        address delegator = 0xF8E893C7D84E366f7Bc6bc1cdB568Ff8c91bCF57;
        address delegate = 0x5bE44e23041E93CDF9bCd5A0968524e104e38ae1;

        CHEATS.prank(delegator);
        BONDING_MANAGER.bond(0, delegate);

        (, , address delegateAddress, , , , ) = BONDING_MANAGER.getDelegator(delegator);

        assertEq(delegateAddress, delegate);
        assertEq(BONDING_MANAGER.transcoderTotalStake(address(0)), 0);
    }
}
