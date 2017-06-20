pragma solidity ^0.4.8;

import "./ECVerify.sol";
import "./MerkleProof.sol";

library TranscodeJobs {
    // Represents a transcode job
    struct Job {
        uint256 jobId;                        // Unique identifer for job
        uint256 streamId;                     // Unique identifier for stream. TODO: change to more semantically proper type when we settle on a streamId representation in the system
        bytes32 transcodingOptions;           // Options used for transcoding
        uint256 maxPricePerSegment;           // Max price (in LPT base units) per segment of a stream
        address broadcasterAddress;           // Address of broadcaster that requestes a transcoding job
        address transcoderAddress;            // Address of transcoder selected for the job
        uint256 endBlock;                     // Block at which the job is ended and considered inactive
        uint256[2] lastClaimedSegmentRange;   // Last range of segments claimed by claimWork()
        uint256 lastClaimedWorkBlock;         // Block number of last call to claimWork()
        uint256 endVerificationBlock;         // Block number of end of verification period
        bytes32[] transcodeClaimsRoots;       // Transcode claim Merkle roots submitted by calls to claimWork()
    }

    // Represents a list of transcode jobs
    struct Jobs {
        mapping (uint256 => Job) jobs;
        uint256 numJobs;
    }

    enum JobStatus { Inactive, Active }

    function jobStatus(Jobs storage self, uint256 _jobId) internal constant returns (JobStatus) {
        if (self.jobs[_jobId].endBlock > 0 && self.jobs[_jobId].endBlock <= block.number) {
            // A job is inactive if its end block is set and the current block is greater than or equal to the job's end block
            return JobStatus.Inactive;
        } else {
            // A job is active if the current block is less than the job's termination block
            return JobStatus.Active;
        }
    }

    function newJob(Jobs storage self, uint256 _streamId, bytes32 _transcodingOptions, uint256 _maxPricePerSegment, address _electedTranscoder) returns (bool) {
        self.jobs[self.numJobs].jobId = self.numJobs;
        self.jobs[self.numJobs].streamId = _streamId;
        self.jobs[self.numJobs].transcodingOptions = _transcodingOptions;
        self.jobs[self.numJobs].maxPricePerSegment = _maxPricePerSegment;
        self.jobs[self.numJobs].broadcasterAddress = msg.sender;
        self.jobs[self.numJobs].transcoderAddress = _electedTranscoder;
        self.numJobs++;

        return true;
    }

    function getJob(Jobs storage self, uint256 _jobId) constant returns (uint256, uint256, bytes32, uint256, address, address, uint256, uint256, uint256) {
        Job job = self.jobs[_jobId];

        return (job.jobId,
                job.streamId,
                job.transcodingOptions,
                job.maxPricePerSegment,
                job.broadcasterAddress,
                job.transcoderAddress,
                job.endBlock,
                job.lastClaimedWorkBlock,
                job.endVerificationBlock
                );
    }

    function getJobWorkDetails(Jobs storage self, uint256 _jobId) constant returns (uint256, uint256, bytes32) {
        Job job = self.jobs[_jobId];

        bytes32 lastTranscodeClaimRoot = 0x0;

        if (job.transcodeClaimsRoots.length > 0) {
            lastTranscodeClaimRoot = job.transcodeClaimsRoots[job.transcodeClaimsRoots.length - 1];
        }

        return (job.lastClaimedSegmentRange[0], job.lastClaimedSegmentRange[1], lastTranscodeClaimRoot);
    }

    function endJob(Jobs storage self, uint256 _jobId, uint256 _jobEndingPeriod) returns (bool) {
        // Check if job already has an end block
        if (self.jobs[_jobId].endBlock > 0) throw;
        // Check if called by either broadcaster or transcoder
        if (msg.sender != self.jobs[_jobId].broadcasterAddress && msg.sender != self.jobs[_jobId].transcoderAddress) throw;

        // Set set end block for job
        self.jobs[_jobId].endBlock = block.number + _jobEndingPeriod;

        return true;
    }

    function claimWork(Jobs storage self, uint256 _jobId, uint256 _startSegmentSequenceNumber, uint256 _endSegmentSequenceNumber, bytes32 _transcodeClaimsRoot, uint256 _verificationPeriod) returns (bool) {
        // Check if job is active
        if (jobStatus(self, _jobId) != JobStatus.Active) throw;
        // Check if sender is assigned transcoder
        if (self.jobs[_jobId].transcoderAddress != msg.sender) throw;
        // Check if previous verification period over
        if (block.number < self.jobs[_jobId].endVerificationBlock) throw;

        self.jobs[_jobId].lastClaimedSegmentRange[0] = _startSegmentSequenceNumber;
        self.jobs[_jobId].lastClaimedSegmentRange[1] = _endSegmentSequenceNumber;
        self.jobs[_jobId].lastClaimedWorkBlock = block.number;
        self.jobs[_jobId].endVerificationBlock = block.number + _verificationPeriod;
        self.jobs[_jobId].transcodeClaimsRoots.push(_transcodeClaimsRoot);

        return true;
    }

    function verify(Jobs storage self, uint256 _jobId, uint256 _segmentSequenceNumber, bytes32 _dataHash, bytes32 _transcodedDataHash, bytes _broadcasterSig, bytes _proof, uint64 _verificationRate) constant returns (bool) {
        // Check if job is active
        if (jobStatus(self, _jobId) != JobStatus.Active) return false;
        // Check if sender is the assigned transcoder
        if (self.jobs[_jobId].transcoderAddress != msg.sender) return false;
        // Check if segment is eligible for verification
        if (!shouldVerifySegment(self, _jobId, _segmentSequenceNumber, _verificationRate)) return false;
        // Check if segment was signed by broadcaster
        if (!ECVerify.ecverify(sha3(self.jobs[_jobId].streamId, _segmentSequenceNumber, _dataHash), _broadcasterSig, self.jobs[_jobId].broadcasterAddress)) return false;
        // Check if transcode claim is included in the Merkle root submitted during the last call to claimWork()
        if (!MerkleProof.verifyProof(_proof,
                                     self.jobs[_jobId].transcodeClaimsRoots[self.jobs[_jobId].transcodeClaimsRoots.length - 1],
                                     sha3(self.jobs[_jobId].streamId, _segmentSequenceNumber, _dataHash, _transcodedDataHash, _broadcasterSig))) return false;

        return true;
    }

    /*
     * Computes whether a segment is eligible for verification based on the last call to claimWork()
     * @param _jobId Job identifier
     * @param _segmentSequenceNumber Sequence number of segment in stream
     * @param _verificationRate Rate at which a particular segment should be verified
     */
    function shouldVerifySegment(Jobs storage self, uint256 _jobId, uint256 _segmentSequenceNumber, uint64 _verificationRate) internal constant returns (bool) {
        // Check if segment is in last claimed segment range
        if (_segmentSequenceNumber < self.jobs[_jobId].lastClaimedSegmentRange[0] || _segmentSequenceNumber > self.jobs[_jobId].lastClaimedSegmentRange[1]) return false;

        if (uint256(sha3(self.jobs[_jobId].lastClaimedWorkBlock, block.blockhash(self.jobs[_jobId].lastClaimedWorkBlock), _segmentSequenceNumber)) % _verificationRate == 0) {
            return true;
        } else {
            return false;
        }
    }
}
