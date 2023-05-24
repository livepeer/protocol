// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./BondingManager.sol";
import "forge-std/console.sol";

contract Votes {
    uint256 public constant MAX_ROUNDS_WITHOUT_CHECKPOINT = 100;

    BondingManager public immutable bondingManager;

    constructor(BondingManager _bondingManager) {
        bondingManager = _bondingManager;
    }

    function getVotes(address _account, uint256 _timepoint) public view returns (uint256) {
        return _getVotes(_account, _timepoint, "");
    }

    function _getVotes(
        address _account,
        uint256 _timepoint,
        bytes memory
    ) internal view returns (uint256) {
        // ASSUMPTIONS
        // - _timepoint is a round number
        // - _timepoint is the start round for the proposal's voting period

        // In this iteration, we only give voting power to transcoders, but a subsequent iteration could give voting power to delegators!

        (, , , uint256 lastActiveStakeUpdateRound, , , , , , ) = bondingManager.getTranscoder(_account);

        // lastActiveStakeUpdateRound is the last round that the transcoder's total active stake (self-delegated + delegated stake) was updated.
        // Any stake changes for a transcoder update the transcoder's total active stake for the *next* round.

        // If lastActiveStakeUpdateRound <= _timepoint, then the transcoder's total active stake at _timepoint should be the transcoder's
        // total active stake at lastActiveStakeUpdateRound because there were no additional stake changes after that round.
        if (lastActiveStakeUpdateRound <= _timepoint) {
            (uint256 totalStake, , , , ) = bondingManager.getTranscoderEarningsPoolForRound(
                _account,
                lastActiveStakeUpdateRound
            );
            return totalStake;
        }

        // If lastActiveStakeUpdateRound > _timepoint, then the transcoder total active stake at _timepoint should be the transcoder's
        // total active stake at the most recent round before _timepoint that the transcoder's total active stake was checkpointed.
        // In order to prevent an unbounded loop, we limit the number of rounds that we'll search for a checkpointed total active stake to
        // MAX_ROUNDS_WITHOUT_CHECKPOINT.
        uint256 end = _timepoint - MAX_ROUNDS_WITHOUT_CHECKPOINT;
        for (uint256 i = _timepoint; i >= end; i--) {
            (uint256 totalStake, , , , ) = bondingManager.getTranscoderEarningsPoolForRound(_account, i);

            if (totalStake > 0) {
                return totalStake;
            }
        }

        return 0;
    }
}
