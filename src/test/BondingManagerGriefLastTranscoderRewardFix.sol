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

        address hacker = newAddr();
        address lastTranscoder = _getLastTranscoder();

        /// attacker need 450 + 2 lpt to execute the attack
        CHEATS.prank(minter);
        lpt.mint(hacker, 450 * 1e18 + 2);

        /// ---------------------- ROUND = 45816 ----------------------
        _skipToNextRound();

        /// attacker bond for themself to make their status in the next round become "Bonded"
        CHEATS.startPrank(hacker);
        lpt.approve(address(bondingManager), type(uint256).max);
        bondingManager.bond(1, hacker);
        CHEATS.stopPrank();

        /// ---------------------- ROUND = 45817 ----------------------
        _skipToNextRound();

        /// attacker bond more than the last transcoder and kick them out of the `transcoderPool`
        CHEATS.startPrank(hacker);
        bondingManager.bond(450 * 1e18, hacker);
        assertEq(hacker, _getLastTranscoder());

        /// attacker unbond all to make the `transcoderPool` not full
        bondingManager.unbond(_getDelegatorData(hacker).bondedAmount);

        /// the `lastTranscoder` is not added into the `transcoderPool` again and become deactivated.
        assertLe(_getTranscoderData(lastTranscoder).activationRound, roundsManager.currentRound());
        assertLt(roundsManager.currentRound(), _getTranscoderData(lastTranscoder).deactivationRound);
        assertEq(_getTranscoderData(lastTranscoder).deactivationRound, roundsManager.currentRound() + 1);
        CHEATS.expectRevert("transcoder has not yet called reward for the current round");
        bondingManager.bond(1, lastTranscoder);
        CHEATS.stopPrank();

        assertNotEq(
            _getTranscoderData(lastTranscoder).activationRound,
            roundsManager.currentRound() + 1,
            "lastTranscoder should not be deactivated"
        );

        /// the `lastTranscoder` is able to claim the reward for ROUND = 3640 because it's considered as active
        // CHEATS.expectRevert(bytes("caller must be an active transcoder"));
        CHEATS.prank(lastTranscoder);
        bondingManager.reward();
        console.log(_getTranscoderData(lastTranscoder).deactivationRound);

        /// Note that the attacker can still withdraw all the fund they use for the attack at the withdrawRound
    }
}
