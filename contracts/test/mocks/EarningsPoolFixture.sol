pragma solidity ^0.5.11;

import "../../bonding/libraries/EarningsPool.sol";
import "../../bonding/libraries/EarningsPoolLIP36.sol";


contract EarningsPoolFixture {
    using EarningsPool for EarningsPool.Data;
    using EarningsPoolLIP36 for EarningsPool.Data;

    EarningsPool.Data prevPool;
    EarningsPool.Data pool;

    function setCommission(uint256 _rewardCut, uint256 _feeShare) public {
        pool.setCommission(_rewardCut, _feeShare);
    }

    function setStake(uint256 _stake) public {
        pool.setStake(_stake);
    }

    function setHasTranscoderRewardFeePool(bool _hasTranscoderRewardFeePool) public {
        pool.hasTranscoderRewardFeePool = _hasTranscoderRewardFeePool;
    }

    function claimShare(uint256 _stake, bool _isTranscoder) public returns (uint256, uint256) {
        return pool.claimShare(_stake, _isTranscoder);
    }

    function addToFeePool(uint256 _fees) public {
        pool.addToFeePool(_fees);
    }

    function addToRewardPool(uint256 _rewards) public {
        pool.addToRewardPool(_rewards);
    }

    function updateCumulativeFeeFactor(uint256 _fees) public {
        pool.updateCumulativeFeeFactor(prevPool, _fees);
    }

    function updateCumulativeRewardFactor(uint256 _rewards) public {
        pool.updateCumulativeRewardFactor(prevPool, _rewards);
    }

    function setPrevPoolEarningsFactors(uint256 _cumulativeFeeFactor, uint256 _cumulativeRewardFactor) public {
        prevPool.cumulativeFeeFactor = _cumulativeFeeFactor;
        prevPool.cumulativeRewardFactor = _cumulativeRewardFactor;
    }

    function hasClaimableShares() public view returns (bool) {
        return pool.hasClaimableShares();
    }

    function feePoolShare(uint256 _stake, bool _isTranscoder) public view returns (uint256) {
        return pool.feePoolShare(_stake, _isTranscoder);
    }

    function rewardPoolShare(uint256 _stake, bool _isTranscoder) public view returns (uint256) {
        return pool.rewardPoolShare(_stake, _isTranscoder);
    }

    function getEarningsPool() public view returns (uint256, uint256, uint256, uint256, bool, uint256, uint256, uint256, uint256) {
        return (
            pool.rewardPool,
            pool.feePool,
            pool.transcoderRewardPool,
            pool.transcoderFeePool,
            pool.hasTranscoderRewardFeePool,
            pool.totalStake,
            pool.claimableStake,
            pool.transcoderRewardCut,
            pool.transcoderFeeShare
        );
    }

    function getRewardPool() public view returns (uint256) {
        return pool.rewardPool;
    }

    function getFeePool() public view returns (uint256) {
        return pool.feePool;
    }

    function getTranscoderRewardPool() public view returns (uint256) {
        return pool.transcoderRewardPool;
    }

    function getTranscoderFeePool() public view returns (uint256) {
        return pool.transcoderFeePool;
    }

    function getHasTranscoderRewardFeePool() public view returns (bool) {
        return pool.hasTranscoderRewardFeePool;
    }

    function getClaimableStake() public view returns (uint256) {
        return pool.claimableStake;
    }

    function getTotalStake() public view returns (uint256) {
        return pool.totalStake;
    }

    function getCumulativeRewardFactor() public view returns (uint256) {
        return pool.cumulativeRewardFactor;
    }

    function getCumulativeFeeFactor() public view returns (uint256) {
        return pool.cumulativeFeeFactor;
    }
}
