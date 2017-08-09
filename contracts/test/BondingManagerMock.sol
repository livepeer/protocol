pragma solidity ^0.4.13;

import "../Manager.sol";
import "../bonding/IBondingManager.sol";

/*
 * @title Mock BondingManager used for testing
 */
contract BondingManagerMock is IBondingManager, Manager {
    uint256 public constant mockTranscoderStake = 500;
    uint256 public constant mockDelegatorStake = 500;
    uint256 public constant mockDelegatorRewards = 500;

    address public mockTranscoder;

    function BondingManagerMock(address _registry, address _mockTranscoder) Manager(_registry) {
        mockTranscoder = _mockTranscoder;
    }

    function transcoder(uint8 _blockRewardCut, uint8 _feeShare, uint256 _pricePerSegment) external returns (bool) {
        return true;
    }

    function resignAsTranscoder() external returns (bool) {
        return true;
    }

    function bond(uint _amount, address _to) external returns (bool) {
        return true;
    }

    function unbond() external returns (bool) {
        return true;
    }

    function withdraw() external returns (bool) {
        return true;
    }

    function reward() external returns (bool) {
        return true;
    }

    function setActiveTranscoders() external returns (bool) {
        return true;
    }

    function updateTranscoderFeePool(address _transcoder, uint256 _fees, uint256 _claimblock, uint256 _transcoderTotalStake) external returns (bool) {
        return true;
    }

    function slashTranscoder(address _transcoder, address _finder, uint64 _slashAmount, uint64 _finderFee) external returns (bool) {
        return true;
    }

    function electActiveTranscoder(uint256 _maxPricePerSegment) external constant returns (address) {
        return mockTranscoder;
    }

    function activeTranscoderTotalStake(address _transcoder) public constant returns (uint256) {
        return mockTranscoderStake;
    }

    function transcoderTotalStake(address _transcoder) public constant returns (uint256) {
        return mockTranscoderStake;
    }

    function delegatorStake(address _delegator) public constant returns (uint256) {
        return mockDelegatorStake;
    }

    function delegatorRewards(address _delegator) public constant returns (uint256) {
        return mockDelegatorRewards;
    }
}
