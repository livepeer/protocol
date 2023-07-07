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

    mapping(address => mapping(uint256 => EarningsPoolMock)) private earningPools;

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
        EarningsPoolMock storage pool = earningPools[_transcoder][_round];

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
        earningPools[_transcoder][_round] = EarningsPoolMock({
            totalStake: _totalStake,
            transcoderRewardCut: _transcoderRewardCut,
            transcoderFeeShare: _transcoderFeeShare,
            cumulativeRewardFactor: _cumulativeRewardFactor,
            cumulativeFeeFactor: _cumulativeFeeFactor
        });
    }
}
