// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./GenericMock.sol";

contract BondingManagerMock is GenericMock {
    event UpdateTranscoderWithFees(address transcoder, uint256 fees, uint256 round);

    struct EarningsPoolMock {
        uint256 totalStake;
        uint256 transcoderRewardCut;
        uint256 transcoderFeeShare;
        uint256 cumulativeRewardFactor;
        uint256 cumulativeFeeFactor;
    }

    struct DelegatorMock {
        uint256 bondedAmount;
        uint256 fees;
        address delegateAddress;
        uint256 delegatedAmount;
        uint256 startRound;
        uint256 lastClaimRound;
        uint256 nextUnbondingLockId;
    }

    mapping(address => mapping(uint256 => EarningsPoolMock)) private earningPoolMocks;

    mapping(address => DelegatorMock) private delegatorMocks;

    function updateTranscoderWithFees(
        address _transcoder,
        uint256 _fees,
        uint256 _round
    ) external {
        emit UpdateTranscoderWithFees(_transcoder, _fees, _round);
    }

    function getTranscoderEarningsPoolForRound(address _transcoder, uint256 _round)
        public
        view
        returns (
            uint256 totalStake,
            uint256 transcoderRewardCut,
            uint256 transcoderFeeShare,
            uint256 cumulativeRewardFactor,
            uint256 cumulativeFeeFactor
        )
    {
        EarningsPoolMock storage pool = earningPoolMocks[_transcoder][_round];

        totalStake = pool.totalStake;
        transcoderRewardCut = pool.transcoderRewardCut;
        transcoderFeeShare = pool.transcoderFeeShare;
        cumulativeRewardFactor = pool.cumulativeRewardFactor;
        cumulativeFeeFactor = pool.cumulativeFeeFactor;
    }

    function setMockTranscoderEarningsPoolForRound(
        address _transcoder,
        uint256 _round,
        uint256 _totalStake,
        uint256 _transcoderRewardCut,
        uint256 _transcoderFeeShare,
        uint256 _cumulativeRewardFactor,
        uint256 _cumulativeFeeFactor
    ) external {
        earningPoolMocks[_transcoder][_round] = EarningsPoolMock({
            totalStake: _totalStake,
            transcoderRewardCut: _transcoderRewardCut,
            transcoderFeeShare: _transcoderFeeShare,
            cumulativeRewardFactor: _cumulativeRewardFactor,
            cumulativeFeeFactor: _cumulativeFeeFactor
        });
    }

    function setMockDelegator(
        address _delegator,
        uint256 _bondedAmount,
        uint256 _fees,
        address _delegateAddress,
        uint256 _delegatedAmount,
        uint256 _startRound,
        uint256 _lastClaimRound,
        uint256 _nextUnbondingLockId
    ) external {
        delegatorMocks[_delegator] = DelegatorMock({
            bondedAmount: _bondedAmount,
            fees: _fees,
            delegateAddress: _delegateAddress,
            delegatedAmount: _delegatedAmount,
            startRound: _startRound,
            lastClaimRound: _lastClaimRound,
            nextUnbondingLockId: _nextUnbondingLockId
        });
    }

    function getDelegator(address _delegator)
        public
        view
        returns (
            uint256 bondedAmount,
            uint256 fees,
            address delegateAddress,
            uint256 delegatedAmount,
            uint256 startRound,
            uint256 lastClaimRound,
            uint256 nextUnbondingLockId
        )
    {
        DelegatorMock storage del = delegatorMocks[_delegator];

        bondedAmount = del.bondedAmount;
        fees = del.fees;
        delegateAddress = del.delegateAddress;
        delegatedAmount = del.delegatedAmount;
        startRound = del.startRound;
        lastClaimRound = del.lastClaimRound;
        nextUnbondingLockId = del.nextUnbondingLockId;
    }
}
