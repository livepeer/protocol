pragma solidity ^0.8.9;

import "ds-test/test.sol";
import "./base/GovernorBaseTest.sol";
import "contracts/rounds/RoundsManager.sol";

// forge test --match-contract LIP83 --fork-url https://arbitrum-mainnet.infura.io/v3/<INFURA_KEY> -vvv --fork-block-number 27464623
contract LIP83 is GovernorBaseTest {
    RoundsManager public constant ROUNDS_MANAGER = RoundsManager(0xdd6f56DcC28D3F5f27084381fE8Df634985cc39f);

    function testExecute() public {
        // Governor stage tx https://arbiscan.io/tx/0xe0985a74cf260bf275b85a7af0880be1e7ff1ca752f546425d7de47b68a11841
        // The stage() call is an inner call since it was triggered via a multisig tx targeting the Governor
        address[] memory targets = new address[](1);
        uint256[] memory values = new uint256[](1);
        bytes[] memory data = new bytes[](1);
        targets[0] = 0xdd6f56DcC28D3F5f27084381fE8Df634985cc39f;
        values[0] = 0;
        data[0] = hex"681312f500000000000000000000000000000000000000000000000000000000000018e9";

        IGovernor.Update memory update = IGovernor.Update({ target: targets, value: values, data: data, nonce: 0 });

        CHEATS.roll(15640718);

        CHEATS.prank(GOVERNOR_OWNER);
        CHEATS.expectRevert(bytes("delay for update not expired"));
        GOVERNOR.execute(update);

        // Fast forward to execute block so update delay is over
        uint256 executeBlock = GOVERNOR.updates(keccak256(abi.encode(update)));
        CHEATS.roll(executeBlock);

        // Check that roundLength is the old value
        assertEq(ROUNDS_MANAGER.roundLength(), 5760);

        CHEATS.prank(GOVERNOR_OWNER);
        GOVERNOR.execute(update);

        // Check that roundLength is the new value
        assertEq(ROUNDS_MANAGER.roundLength(), 6377);
    }
}
