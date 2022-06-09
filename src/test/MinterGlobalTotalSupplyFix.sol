pragma solidity ^0.8.9;

import "ds-test/test.sol";
import "./base/GovernorBaseTest.sol";
import "contracts/token/LivepeerToken.sol";
import "contracts/token/Minter.sol";

// forge test -vvv --fork-url <ARB_MAINNET_RPC_URL> --fork-block-number 6251064 --match-contract MinterGlobalTotalSupplyFix
contract MinterGlobalTotalSupplyFix is GovernorBaseTest {
    Minter public constant MINTER = Minter(0x4969dcCF5186e1c49411638fc8A2a020Fdab752E);
    LivepeerToken public constant TOKEN = LivepeerToken(0x289ba1701C2F088cf0faf8B3705246331cB8A839);

    address public constant ROUNDS_MANAGER_ADDR = 0xdd6f56DcC28D3F5f27084381fE8Df634985cc39f;

    bytes32 public constant MINTER_ID = keccak256("Minter");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    Minter public newMinter;

    function upgrade() public {
        address[] memory targets = new address[](4);
        uint256[] memory values = new uint256[](4);
        bytes[] memory data = new bytes[](4);

        targets[0] = address(MINTER);
        targets[1] = address(TOKEN);
        targets[2] = address(TOKEN);
        targets[3] = address(CONTROLLER);

        values[0] = 0;
        values[1] = 0;
        values[2] = 0;
        values[3] = 0;

        (, bytes20 gitCommitHash) = CONTROLLER.getContractInfo(MINTER_ID);
        data[0] = abi.encodeWithSelector(MINTER.migrateToNewMinter.selector, address(newMinter));
        data[1] = abi.encodeWithSelector(TOKEN.grantRole.selector, MINTER_ROLE, address(newMinter));
        data[2] = abi.encodeWithSelector(TOKEN.revokeRole.selector, MINTER_ROLE, address(MINTER));
        data[3] = abi.encodeWithSelector(
            CONTROLLER.setContractInfo.selector,
            MINTER_ID,
            address(newMinter),
            gitCommitHash
        );
        stageAndExecuteMany(targets, values, data);
    }

    function testUpgrade() public {
        newMinter = new Minter(
            address(MINTER.controller()),
            MINTER.inflation(),
            MINTER.inflationChange(),
            MINTER.targetBondingRate()
        );
        assertEq(address(newMinter.controller()), address(MINTER.controller()));
        assertEq(newMinter.inflation(), MINTER.inflation());
        assertEq(newMinter.inflationChange(), MINTER.inflationChange());
        assertEq(newMinter.targetBondingRate(), MINTER.targetBondingRate());

        uint256 minterLPTBal = TOKEN.balanceOf(address(MINTER));
        uint256 minterETHBal = address(MINTER).balance;

        (, bytes20 gitCommitHash) = CONTROLLER.getContractInfo(MINTER_ID);

        // Impersonate Governor owner which is also Controller owner
        CHEATS.prank(GOVERNOR_OWNER);
        // Make sure Controller is owned by Governor
        CONTROLLER.transferOwnership(address(GOVERNOR));
        upgrade();

        // Check that assets are moved over
        assertEq(TOKEN.balanceOf(address(newMinter)), minterLPTBal);
        assertEq(address(newMinter).balance, minterETHBal);

        // Check that new Minter is registered
        (address infoAddr, bytes20 infoGitCommitHash) = CONTROLLER.getContractInfo(MINTER_ID);
        assertEq(infoAddr, address(newMinter));
        assertEq(infoGitCommitHash, gitCommitHash);

        // Check that minting rights are updated
        assertTrue(TOKEN.hasRole(MINTER_ROLE, address(newMinter)));
        assertTrue(!TOKEN.hasRole(MINTER_ROLE, address(MINTER)));

        // Fast forward to start of next round
        uint256 currRound = 2469;
        uint256 roundLen = 5760;
        uint256 nextRoundStartBlock = currRound * roundLen + roundLen;
        CHEATS.roll(nextRoundStartBlock);

        // Impersonate the RoundsManager
        CHEATS.prank(ROUNDS_MANAGER_ADDR);
        // This function would be called during initializeRound() at the start of a round
        newMinter.setCurrentRewardTokens();

        // Check that currentMintableTokens is calculated based on global total supply and NOT just L2 total supply
        uint256 inflation = newMinter.inflation();
        uint256 totalSupply = newMinter.getGlobalTotalSupply();
        assertEq(MathUtils.percOf(totalSupply, inflation), newMinter.currentMintableTokens());
    }
}
