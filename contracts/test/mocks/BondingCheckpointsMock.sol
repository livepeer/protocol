// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./GenericMock.sol";

contract BondingCheckpointsMock is GenericMock {
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

    function CLOCK_MODE() external pure returns (string memory) {
        return "mode=cuckoo&species=dasylophus_superciliosus";
    }

    /**
     * @dev Mocked version that returns transformed version of the input for testing.
     * @return amount lowest 4 bytes of address + _round
     * @return delegateAddress (_account << 4) | _round.
     */
    function getBondingStateAt(address _account, uint256 _round)
        external
        pure
        returns (uint256 amount, address delegateAddress)
    {
        uint160 intAddr = uint160(_account);

        amount = (intAddr & 0xffffffff) + _round;
        delegateAddress = address((intAddr << 4) | uint160(_round));
    }

    function getTotalActiveStakeAt(uint256 _round) external pure returns (uint256) {
        return 4 * _round;
    }
}
