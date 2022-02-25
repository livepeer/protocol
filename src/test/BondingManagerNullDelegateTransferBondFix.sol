pragma solidity ^0.8.9;

import "ds-test/test.sol";
import "contracts/governance/Governor.sol";
import "contracts/Controller.sol";
import "contracts/bonding/BondingManager.sol";
import "contracts/snapshots/MerkleSnapshot.sol";

interface CheatCodes {
    function roll(uint256) external;

    function mockCall(
        address,
        bytes calldata,
        bytes calldata
    ) external;

    function prank(address) external;
}

interface L2Migrator {
    function claimStake(
        address,
        uint256,
        uint256,
        bytes32[] calldata,
        address
    ) external;
}

// forge test -vvv --fork-url <ARB_MAINNET_RPC_URL> --fork-block-number 6768454 --match-contract BondingManagerNullDelegateTransferBondFix
contract BondingManagerNullDelegateTransferBondFix is DSTest {
    CheatCodes public constant CHEATS = CheatCodes(HEVM_ADDRESS);

    Governor public constant GOVERNOR = Governor(0xD9dEd6f9959176F0A04dcf88a0d2306178A736a6);
    Controller public constant CONTROLLER = Controller(0xD8E8328501E9645d16Cf49539efC04f734606ee4);
    BondingManager public constant BONDING_MANAGER = BondingManager(0x35Bcf3c30594191d53231E4FF333E8A770453e40);
    MerkleSnapshot public constant MERKLE_SNAPSHOT = MerkleSnapshot(0x10736ffaCe687658F88a46D042631d182C7757f7);
    L2Migrator public constant L2_MIGRATOR = L2Migrator(0x148D5b6B4df9530c7C76A810bd1Cdf69EC4c2085);

    address public constant GOVERNOR_OWNER = 0x04F53A0bb244f015cC97731570BeD26F0229da05;

    bytes32 public constant BONDING_MANAGER_TARGET_ID = keccak256("BondingManagerTarget");

    // Governor update
    address[] public targets;
    uint256[] public values;
    bytes[] public datas;

    BondingManager public newBondingManagerTarget;

    function setUp() public {
        newBondingManagerTarget = new BondingManager(address(CONTROLLER));

        targets = [address(CONTROLLER)];
        values = [0];

        (, bytes20 gitCommitHash) = CONTROLLER.getContractInfo(BONDING_MANAGER_TARGET_ID);
        datas = [
            abi.encodeWithSelector(
                CONTROLLER.setContractInfo.selector,
                BONDING_MANAGER_TARGET_ID,
                address(newBondingManagerTarget),
                gitCommitHash
            )
        ];
    }

    function testUpgrade() public {
        (, bytes20 gitCommitHash) = CONTROLLER.getContractInfo(BONDING_MANAGER_TARGET_ID);

        Governor.Update memory update = Governor.Update({ target: targets, value: values, data: datas, nonce: 0 });

        // Impersonate Governor owner
        CHEATS.prank(GOVERNOR_OWNER);
        GOVERNOR.stage(update, 0);
        GOVERNOR.execute(update);

        // Check that new BondingManagerTarget is registered
        (address infoAddr, bytes20 infoGitCommitHash) = CONTROLLER.getContractInfo(BONDING_MANAGER_TARGET_ID);
        assertEq(infoAddr, address(newBondingManagerTarget));
        assertEq(infoGitCommitHash, gitCommitHash);

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
