pragma solidity ^0.4.13;

import "../bonding/IBondingManager.sol";
import "../jobs/IJobsManager.sol";


contract JobsManagerMock is IJobsManager {
    IBondingManager bondingManager;

    address public mockTranscoder;
    uint256 public mockClaimId;
    uint256 public mockSegmentNumber;
    uint256 public mockFees;
    uint256 public mockClaimBlock;
    uint256 public mockTranscoderTotalStake;
    address public mockFinder;
    uint64 public mockSlashAmount;
    uint64 public mockFinderFee;

    function JobsManagerMock(address _bondingManager) {
        bondingManager = IBondingManager(_bondingManager);
    }

    function setMockTranscoder(address _transcoder) external returns (bool) {
        mockTranscoder = _transcoder;
        return true;
    }

    function setMockClaimId(uint256 _claimId) external returns (bool) {
        mockClaimId = _claimId;
        return true;
    }

    function setMockFees(uint256 _fees) external returns (bool) {
        mockFees = _fees;
        return true;
    }

    function setMockClaimBlock(uint256 _claimBlock) external returns (bool) {
        mockClaimBlock = _claimBlock;
        return true;
    }

    function setMockTranscoderTotalStake(uint256 _transcoderTotalStake) external returns (bool) {
        mockTranscoderTotalStake = _transcoderTotalStake;
        return true;
    }

    function setMockSegmentNumber(uint256 _segmentNumber) external returns (bool) {
        mockSegmentNumber = _segmentNumber;
        return true;
    }

    function distributeFees() public returns (bool) {
        return bondingManager.updateTranscoderFeePool(mockTranscoder, mockFees, mockClaimBlock, mockTranscoderTotalStake);
    }

    function missedVerificationSlash() public returns (bool) {
        return bondingManager.slashTranscoder(mockTranscoder, mockFinder, mockSlashAmount, mockFinderFee);
    }
}
