// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../../libraries/MathUtils.sol";
import "../../bonding/libraries/EarningsPool.sol";
import "../../bonding/libraries/EarningsPoolLIP36.sol";

import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract EarningsPoolFixture {
    using SafeMath for uint256;
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

    function getTranscoderRewardCut() public view returns (uint256) {
        return pool.transcoderRewardCut;
    }

    function getTranscoderFeeShare() public view returns (uint256) {
        return pool.transcoderFeeShare;
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
