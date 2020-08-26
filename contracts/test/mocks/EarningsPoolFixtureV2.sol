pragma solidity ^0.5.11;

import "../../bonding/libraries/EarningsPoolV2.sol";
import "../../libraries/MathUtils.sol";

import "openzeppelin-solidity/contracts/math/SafeMath.sol";

contract EarningsPoolFixture {
    using EarningsPool for EarningsPool.Data;
    using SafeMath for uint256;

    EarningsPool.Data prevPool;
    EarningsPool.Data pool;

    function setCommission(uint256 _rewardCut, uint256 _feeShare) public {
        pool.setCommission(_rewardCut, _feeShare);
    }

    function setStake(uint256 _stake) public {
        pool.setStake(_stake);
    }

    function claimShare(uint256 _stake, bool _isTranscoder) public returns (uint256, uint256) {
        return pool.claimShare(_stake, _isTranscoder);
    }

    function addToFeePool(uint256 _fees) public {
        pool.addToFeePool(prevPool, _fees);
    }

    function addToRewardPool(uint256 _rewards) public {
        pool.addToRewardPool(prevPool, _rewards);
    }

    function setPrevPoolEarningsFactors(uint256 _cumulativeFeeFactor, uint256 _cumulativeRewardFactor) public {
        prevPool.cumulativeFeeFactor = _cumulativeFeeFactor;
        prevPool.cumulativeRewardFactor = _cumulativeRewardFactor;
    }

    function setV1PoolEarnings(uint256 _rewards, uint256 _fees) public {
        uint256 transcoderRewards = MathUtils.percOf(_rewards, pool.transcoderRewardCut);
        pool.rewardPool = pool.rewardPool.add(_rewards.sub(transcoderRewards));
        pool.transcoderRewardPool = pool.transcoderRewardPool.add(transcoderRewards);

        uint256 delegatorFees = MathUtils.percOf(_fees, pool.transcoderFeeShare);
        pool.feePool = pool.feePool.add(delegatorFees);
        pool.transcoderFeePool = pool.transcoderFeePool.add(_fees.sub(delegatorFees));
       
        pool.hasTranscoderRewardFeePool = true;
    }

    function setV1PoolStake(uint256 _totalStake, uint256 _claimableStake) public {
        pool.totalStake = _totalStake;
        pool.claimableStake = _claimableStake;
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

    function getCommission() public view returns (uint256 rewardCut, uint256 feeShare) {
        return (pool.transcoderRewardCut, pool.transcoderFeeShare);
    }
}