pragma solidity ^0.8.9;

import "ds-test/test.sol";
import "contracts/governance/Governor.sol";
import "contracts/bonding/BondingManager.sol";
import "contracts/snapshots/MerkleSnapshot.sol";
import "contracts/token/LivepeerToken.sol";
import "contracts/rounds/RoundsManager.sol";
import "contracts/Controller.sol";

interface CheatCodes {
    function roll(uint256) external;

    function startPrank(address) external;

    function prank(address) external;

    function stopPrank() external;

    function assume(bool) external;
}

// forge test -vvv --fork-url <ARB_MAINNET_RPC_URL> --fork-block-number 6768456 --match-contract BondingManagerFuzzer
contract BondingManagerFuzzer is DSTest {
    CheatCodes public constant CHEATS = CheatCodes(HEVM_ADDRESS);

    BondingManager public constant BONDING_MANAGER = BondingManager(0x35Bcf3c30594191d53231E4FF333E8A770453e40);
    LivepeerToken public constant LIVEPEER_TOKEN = LivepeerToken(0x289ba1701C2F088cf0faf8B3705246331cB8A839);
    RoundsManager public constant ROUNDS_MANAGER = RoundsManager(0xdd6f56DcC28D3F5f27084381fE8Df634985cc39f);
    Controller public constant CONTROLLER = Controller(0xD8E8328501E9645d16Cf49539efC04f734606ee4);

    address public constant MINTER_ADDRESS = 0xc20DE37170B45774e6CD3d2304017fc962f27252;
    address public constant DELEGATOR = 0xF8E893C7D84E366f7Bc6bc1cdB568Ff8c91bCF57;
    address public constant DELEGATOR_B = 0x5bE44e23041E93CDF9bCd5A0968524e104e38ae1;
    address public constant DELEGATE = 0xDcd2CD1a27118E65A3d8aF6518F62b78D056Ac5a;
    uint256 public constant STARTING_BLOCK = 14265594;

    function testTransferBond(uint256 _amount) public {
        CHEATS.assume(_amount > 0.01 ether && _amount < 100000 ether);
        CHEATS.roll(STARTING_BLOCK);
        CHEATS.prank(DELEGATOR_B);
        BONDING_MANAGER.claimEarnings(0);
        CHEATS.prank(DELEGATOR);
        BONDING_MANAGER.claimEarnings(0);

        CHEATS.prank(MINTER_ADDRESS);
        LIVEPEER_TOKEN.mint(DELEGATOR, _amount);

        CHEATS.startPrank(DELEGATOR);
        (uint256 initialBondedAmount, , , , , , ) = BONDING_MANAGER.getDelegator(DELEGATOR);

        LIVEPEER_TOKEN.approve(address(BONDING_MANAGER), _amount);
        BONDING_MANAGER.bond(_amount, DELEGATE);

        // time-travels to new new round and initializes it
        CHEATS.roll(STARTING_BLOCK + ROUNDS_MANAGER.roundLength());
        ROUNDS_MANAGER.initializeRound();
        (uint256 updatedBondedAmount, , address updatedDelegateAddress, , , , ) = BONDING_MANAGER.getDelegator(
            DELEGATOR
        );
        assertEq(updatedBondedAmount, initialBondedAmount + _amount);
        assertEq(updatedDelegateAddress, DELEGATE);

        (uint256 initialRecipientBondedAmount, , address initialRecipientDelegateAddress, , , , ) = BONDING_MANAGER
            .getDelegator(DELEGATOR_B);

        BondingManager(BONDING_MANAGER).transferBond(
            DELEGATOR_B,
            _amount,
            address(0),
            address(0),
            address(0),
            address(0)
        );

        (uint256 bondedAmountAfter, , address delegateAddressAfter, , , , ) = BONDING_MANAGER.getDelegator(DELEGATOR);
        assertEq(delegateAddressAfter, bondedAmountAfter == 0 ? address(0) : DELEGATE);
        assertEq(bondedAmountAfter, updatedBondedAmount - _amount);

        (uint256 recipientBondedAmountAfter, , address recipientDelegateAddressAfter, , , , ) = BONDING_MANAGER
            .getDelegator(DELEGATOR_B);

        assertEq(recipientDelegateAddressAfter, initialRecipientDelegateAddress);
        assertTrue(recipientDelegateAddressAfter != address(0));
        assertEq(recipientBondedAmountAfter, initialRecipientBondedAmount + _amount);

        CHEATS.stopPrank();
    }
}
