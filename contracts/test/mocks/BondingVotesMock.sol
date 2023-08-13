// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./GenericMock.sol";

contract BondingVotesMock is GenericMock {
    event CheckpointBondingState(
        address account,
        uint256 startRound,
        uint256 bondedAmount,
        address delegateAddress,
        uint256 delegatedAmount,
        uint256 lastClaimRound,
        uint256 lastRewardRound
    );
    event CheckpointTotalActiveStake(uint256 totalStake, uint256 round);

    function checkpointBondingState(
        address _account,
        uint256 _startRound,
        uint256 _bondedAmount,
        address _delegateAddress,
        uint256 _delegatedAmount,
        uint256 _lastClaimRound,
        uint256 _lastRewardRound
    ) external {
        emit CheckpointBondingState(
            _account,
            _startRound,
            _bondedAmount,
            _delegateAddress,
            _delegatedAmount,
            _lastClaimRound,
            _lastRewardRound
        );
    }

    function checkpointTotalActiveStake(uint256 _totalStake, uint256 _round) external {
        emit CheckpointTotalActiveStake(_totalStake, _round);
    }
}
