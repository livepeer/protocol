pragma solidity ^0.4.13;

import "../bonding/IBondingManager.sol";
import "../jobs/IJobsManager.sol";
import "../token/IMinter.sol";
import "../verification/IVerifier.sol";


contract JobsManagerMock is IJobsManager {
    IBondingManager bondingManager;
    IMinter minter;
    IVerifier verifier;

    address public transcoder;
    uint256 public jobId;
    uint256 public claimId;
    uint256 public segmentNumber;
    string public transcodingOptions;
    string public dataStorageHash;
    bytes32[2] public dataHashes;
    uint256 public fees;
    uint256 public round;
    uint256 public claimBlock;
    uint256 public transcoderTotalStake;
    uint256 public withdrawAmount;
    address public finder;
    uint64 public slashAmount;
    uint64 public finderFee;

    function setMinter(address _minter) external {
        minter = IMinter(_minter);
    }

    function setBondingManager(address _bondingManager) {
        bondingManager = IBondingManager(_bondingManager);
    }

    function setVerifier(address _verifier) {
        verifier = IVerifier(_verifier);
    }

    function setVerifyParams(uint256 _jobId, uint256 _claimId, uint256 _segmentNumber, string _transcodingOptions, string _dataStorageHash, bytes32[2] _dataHashes) external {
        jobId = _jobId;
        claimId = _claimId;
        segmentNumber = _segmentNumber;
        transcodingOptions = _transcodingOptions;
        dataStorageHash = _dataStorageHash;
        dataHashes = _dataHashes;
    }

    function setDistributeFeesParams(address _transcoder, uint256 _fees, uint256 _round) external {
        transcoder = _transcoder;
        fees = _fees;
        round = _round;
    }

    function setTranscoder(address _transcoder) external {
        transcoder = _transcoder;
    }

    function setClaimId(uint256 _claimId) external {
        claimId = _claimId;
    }

    function setFees(uint256 _fees) external {
        fees = _fees;
    }

    function setClaimBlock(uint256 _claimBlock) external {
        claimBlock = _claimBlock;
    }

    function setTranscoderTotalStake(uint256 _transcoderTotalStake) external {
        transcoderTotalStake = _transcoderTotalStake;
    }

    function setSegmentNumber(uint256 _segmentNumber) external {
        segmentNumber = _segmentNumber;
    }

    function setWithdrawAmount(uint256 _amount) external {
        withdrawAmount = _amount;
    }

    function distributeFees() public returns (bool) {
        return bondingManager.updateTranscoderWithFees(transcoder, fees, round);
    }

    function missedVerificationSlash() public returns (bool) {
        return bondingManager.slashTranscoder(transcoder, finder, slashAmount, finderFee);
    }

    function withdraw() external {
        minter.transferTokens(msg.sender, withdrawAmount);
    }

    function callVerify() external payable {
        verifier.verify.value(msg.value)(jobId, claimId, segmentNumber, transcodingOptions, dataStorageHash, dataHashes);
    }

    function receiveVerification(uint256 _jobId, uint256 _claimId, uint256 _segmentNumber, bool _result) external returns (bool) {
        return true;
    }

    function callElectActiveTranscoder(uint256 _maxPricePerSegment) external {
        bondingManager.electActiveTranscoder(_maxPricePerSegment);
    }
}
