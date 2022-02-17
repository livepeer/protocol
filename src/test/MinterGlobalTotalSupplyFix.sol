pragma solidity ^0.8.9;

import "ds-test/test.sol";
import "contracts/governance/Governor.sol";
import "contracts/Controller.sol";
import "contracts/token/LivepeerToken.sol";
import "contracts/token/Minter.sol";

interface CheatCodes {
    function roll(uint256) external;

    function prank(address) external;
}

contract MinterGlobalTotalSupplyFix is DSTest {
    CheatCodes public constant CHEATS = CheatCodes(HEVM_ADDRESS);

    Governor public constant GOVERNOR = Governor(0xD9dEd6f9959176F0A04dcf88a0d2306178A736a6);
    Minter public constant MINTER = Minter(0x4969dcCF5186e1c49411638fc8A2a020Fdab752E);
    Controller public constant CONTROLLER = Controller(0xD8E8328501E9645d16Cf49539efC04f734606ee4);
    LivepeerToken public constant TOKEN = LivepeerToken(0x289ba1701C2F088cf0faf8B3705246331cB8A839);

    address public constant ROUNDS_MANAGER_ADDR = 0xdd6f56DcC28D3F5f27084381fE8Df634985cc39f;
    address public constant GOVERNOR_OWNER = 0x04F53A0bb244f015cC97731570BeD26F0229da05;

    bytes32 public constant MINTER_ID = keccak256("Minter");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // Governor update
    address[] public targets;
    uint256[] public values;
    bytes[] public datas;

    Minter public newMinter;

    function setUp() public {
        newMinter = new Minter(
            address(MINTER.controller()),
            MINTER.inflation(),
            MINTER.inflationChange(),
            MINTER.targetBondingRate()
        );

        targets = [address(MINTER), address(TOKEN), address(TOKEN), address(CONTROLLER)];
        values = [0, 0, 0, 0];

        (, bytes20 gitCommitHash) = CONTROLLER.getContractInfo(MINTER_ID);
        datas = [
            abi.encodeWithSelector(MINTER.migrateToNewMinter.selector, address(newMinter)),
            abi.encodeWithSelector(TOKEN.grantRole.selector, MINTER_ROLE, address(newMinter)),
            abi.encodeWithSelector(TOKEN.revokeRole.selector, MINTER_ROLE, address(MINTER)),
            abi.encodeWithSelector(CONTROLLER.setContractInfo.selector, MINTER_ID, address(newMinter), gitCommitHash)
        ];
    }

    function testUpgrade() public {
        assertEq(address(newMinter.controller()), address(MINTER.controller()));
        assertEq(newMinter.inflation(), MINTER.inflation());
        assertEq(newMinter.inflationChange(), MINTER.inflationChange());
        assertEq(newMinter.targetBondingRate(), MINTER.targetBondingRate());

        uint256 minterLPTBal = TOKEN.balanceOf(address(MINTER));
        uint256 minterETHBal = address(MINTER).balance;

        (, bytes20 gitCommitHash) = CONTROLLER.getContractInfo(MINTER_ID);

        Governor.Update memory update = Governor.Update({ target: targets, value: values, data: datas, nonce: 0 });

        // Impersonate Governor owner which is also Controller owner
        CHEATS.prank(GOVERNOR_OWNER);
        // Make sure Controller is owned by Governor
        CONTROLLER.transferOwnership(address(GOVERNOR));

        // Impersonate Governor owner again
        CHEATS.prank(GOVERNOR_OWNER);
        GOVERNOR.stage(update, 0);
        GOVERNOR.execute(update);

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
