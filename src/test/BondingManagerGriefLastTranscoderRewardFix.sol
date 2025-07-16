// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "./BondingManagerGriefLastTranscoderRewardPoc.sol";
import { BondingManager } from "contracts/bonding/BondingManager.sol";

// forge test --match-contract BondingManagerGriefLastTranscoderRewardFix --fork-url https://arbitrum-mainnet.infura.io/v3/$INFURA_KEY -vvv
contract BondingManagerGriefLastTranscoderRewardFix is BondingManagerGriefLastTranscoderRewardPoc {
    function testFix() public {
        // Deploy new `BondingManager`
        BondingManager newBondingManagerTarget = new BondingManager(address(CONTROLLER));

        // Update `BondingManagerTarget` using the helper
        stageAndExecuteOne(
            address(CONTROLLER),
            0,
            abi.encodeWithSelector(
                CONTROLLER.setContractInfo.selector,
                keccak256(abi.encodePacked("BondingManagerTarget")),
                address(newBondingManagerTarget),
                bytes32(0)
            )
        );

        address attacker = newAddr();
        address lastTranscoder = _getLastTranscoder();

        // Attacker needs 450 + 2 lpt to execute the attack
        vm.prank(minter);
        lpt.mint(attacker, 450 * 1e18 + 2);

        // ---------------------- ROUND = 45816 ----------------------
        _skipToNextRound();

        // Attacker bonds for themself to make their status in the next round become "Bonded"
        vm.startPrank(attacker);
        lpt.approve(address(bondingManager), type(uint256).max);
        bondingManager.bond(1, attacker);
        vm.stopPrank();

        // ---------------------- ROUND = 45817 ----------------------
        _skipToNextRound();

        // Attacker bonds more than the last transcoder and kicks them out of the `transcoderPool`
        vm.startPrank(attacker);
        bondingManager.bond(450 * 1e18, attacker);
        assertEq(attacker, _getLastTranscoder());

        // Attacker unbonds all to make the `transcoderPool` not full
        bondingManager.unbond(_getDelegatorData(attacker).bondedAmount);

        // The `lastTranscoder` is not added into the `transcoderPool` again and becomes deactivated
        assertLe(_getTranscoderData(lastTranscoder).activationRound, roundsManager.currentRound());
        assertLt(roundsManager.currentRound(), _getTranscoderData(lastTranscoder).deactivationRound);
        assertEq(_getTranscoderData(lastTranscoder).deactivationRound, roundsManager.currentRound() + 1);
        vm.expectRevert("transcoder has not yet called reward for the current round");
        bondingManager.bond(1, lastTranscoder);
        vm.stopPrank();

        assertNotEq(
            _getTranscoderData(lastTranscoder).activationRound,
            roundsManager.currentRound() + 1,
            "lastTranscoder should not be deactivated"
        );

        // The `lastTranscoder` is able to claim the reward for ROUND = 3640 because it is considered as active
        vm.prank(lastTranscoder);
        bondingManager.reward();
        console.log(_getTranscoderData(lastTranscoder).deactivationRound);
    }

    function testFixRebond() public {
        // Deploy new `BondingManager`
        BondingManager newBondingManagerTarget = new BondingManager(address(CONTROLLER));

        // Update `BondingManagerTarget` using the helper
        stageAndExecuteOne(
            address(CONTROLLER),
            0,
            abi.encodeWithSelector(
                CONTROLLER.setContractInfo.selector,
                keccak256(abi.encodePacked("BondingManagerTarget")),
                address(newBondingManagerTarget),
                bytes32(0)
            )
        );

        // Attacker needs two accounts for the attack
        address attacker = newAddr();
        address attackerForRebond = newAddr();
        address lastTranscoder = _getLastTranscoder();

        // Attacker needs 450 + 3 lpt to execute the attack
        vm.startPrank(minter);
        lpt.mint(attacker, 450 * 1e18 + 1);
        lpt.mint(attackerForRebond, 2);
        vm.stopPrank();

        // ---------------------- ROUND = 45816 ----------------------
        _skipToNextRound();

        // Attacker bonds to the last transcoder and immediately unbonds
        vm.startPrank(attackerForRebond);
        lpt.approve(address(bondingManager), type(uint256).max);
        bondingManager.bond(2, lastTranscoder);
        vm.stopPrank();

        // Attacker bonds for themself to make their status in the next round become "Bonded"
        vm.startPrank(attacker);
        lpt.approve(address(bondingManager), type(uint256).max);
        bondingManager.bond(1, attacker);
        vm.stopPrank();

        // ---------------------- ROUND = 45817 ----------------------
        _skipToNextRound();

        // Attacker bonds more than the last transcoder and kick them out of the `transcoderPool`
        vm.startPrank(attacker);
        bondingManager.bond(450 * 1e18, attacker);
        assertEq(attacker, _getLastTranscoder());

        // Attacker unbonds all to make the `transcoderPool` not full
        bondingManager.unbond(_getDelegatorData(attacker).bondedAmount);
        vm.stopPrank();

        // Attacker unbonds and rebonds the last transcoder,
        // the `lastTranscoder` is added into the `transcoderPool` again and becomes deactivated
        uint256 unbondingLockId = _getDelegatorData(attackerForRebond).nextUnbondingLockId;
        vm.startPrank(attackerForRebond);
        bondingManager.unbond(1);
        vm.expectRevert("transcoder has not yet called reward for the current round");
        bondingManager.rebond(unbondingLockId);
        vm.stopPrank();

        assertNotEq(_getTranscoderData(lastTranscoder).activationRound, roundsManager.currentRound() + 1);

        // The `lastTranscoder` is able to claim the reward for ROUND = 3640 because it is considered as active
        vm.prank(lastTranscoder);
        bondingManager.reward();
        console.log(_getTranscoderData(lastTranscoder).deactivationRound);
    }
}
