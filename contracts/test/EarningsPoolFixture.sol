pragma solidity ^0.4.17;

import "../bonding/libraries/EarningsPool.sol";


contract EarningsPoolFixture {
    using EarningsPool for EarningsPool.Data;

    EarningsPool.Data pool;

    function init(uint256 _stake, uint256 _rewardCut, uint256 _feeShare) public {
        pool.init(_stake, _rewardCut, _feeShare);
    }

    function claimShare(uint256 _stake, bool _isTranscoder) public returns (uint256, uint256) {
        return pool.claimShare(_stake, _isTranscoder);
    }

    function setFeePool(uint256 _fees) public {
        pool.feePool = _fees;
    }

    function setRewardPool(uint256 _rewards) public {
        pool.rewardPool = _rewards;
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

    function getEarningsPool() public view returns (uint256, uint256, uint256, uint256, uint256, uint256) {
        return (pool.rewardPool, pool.feePool, pool.totalStake, pool.claimableStake, pool.transcoderRewardCut, pool.transcoderFeeShare);
    }

    function getRewardPool() public view returns (uint256) {
        return pool.rewardPool;
    }

    function getFeePool() public view returns (uint256) {
        return pool.feePool;
    }

    function getClaimableStake() public view returns (uint256) {
        return pool.claimableStake;
    }
}
