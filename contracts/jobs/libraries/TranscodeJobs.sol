pragma solidity ^0.4.11;

import "./ECVerify.sol";
import "./MerkleProof.sol";

library TranscodeJobs {
    // Represents a transcode job
    struct Job {
        uint256 jobId;                        // Unique identifer for job
        string streamId;                      // Unique identifier for stream.
        bytes32 transcodingOptions;           // Options used for transcoding
        uint256 maxPricePerSegment;           // Max price (in LPT base units) per segment of a stream
        address broadcasterAddress;           // Address of broadcaster that requestes a transcoding job
        address transcoderAddress;            // Address of transcoder selected for the job
        uint256 endBlock;                     // Block at which the job is ended and considered inactive
        uint256[2] lastClaimedSegmentRange;   // Last range of segments claimed by claimWork()
        uint256 lastClaimedWorkBlock;         // Block number of last call to claimWork()
        uint256 endVerificationBlock;         // Block number of end of verification period
        bytes32 lastTranscodeClaimsRoot;      // Last transcode claim Merkle root submitted by a call to claimWork()
    }

    // Represents a list of transcode jobs
    struct Jobs {
        mapping (uint256 => Job) jobs;
        uint256 numJobs;
    }

    // States that a job can be in
    enum JobStatus { Inactive, Active }

    // Events
    event NewJob(address indexed transcoder, address indexed broadcaster, uint256 jobId);

    /*
     * Compute status of job
     * @param self Jobs struct storage receiver
     * @param _jobId Job identifier
     */
    function jobStatus(Jobs storage self, uint256 _jobId) internal constant returns (JobStatus) {
        // Check for valid job id
        if (_jobId >= self.numJobs) throw;

        if (self.jobs[_jobId].endBlock > 0 && self.jobs[_jobId].endBlock <= block.number) {
            // A job is inactive if its end block is set and the current block is greater than or equal to the job's end block
            return JobStatus.Inactive;
        } else {
            // A job is active if the current block is less than the job's termination block
            return JobStatus.Active;
        }
    }

    /*
     * Create a new job and add it to the set of jobs
     * @param self Jobs struct storage receiver
     * @param _streamId Unique stream identifier
     * @param _transcodingOptions Output bitrates, formats, encodings
     * @param _maxPricePerSegment Max price (in LPT base units) to pay for transcoding a segment of a stream
     * @param _electedTranscoder Address of elected transcoder for the new job
     */
    function newJob(Jobs storage self, string _streamId, bytes32 _transcodingOptions, uint256 _maxPricePerSegment, address _electedTranscoder) returns (bool) {
        self.jobs[self.numJobs].jobId = self.numJobs;
        self.jobs[self.numJobs].streamId = _streamId;
        self.jobs[self.numJobs].transcodingOptions = _transcodingOptions;
        self.jobs[self.numJobs].maxPricePerSegment = _maxPricePerSegment;
        self.jobs[self.numJobs].broadcasterAddress = msg.sender;
        self.jobs[self.numJobs].transcoderAddress = _electedTranscoder;

        NewJob(_electedTranscoder, msg.sender, self.numJobs);

        self.numJobs++;

        // TODO: Validation on _transcodingOptions

        return true;
    }

    /*
     * Return a job
     * Note: this function does not return all the fields for a job. See comment for getJobTranscodeClaimsDetails() for an explanation
     * streamId is retrieved separately in the LivepeerProtocol contract because external calls in contracts cannot return dynamic types
     * @param self Jobs struct storage receiver
     * @param _jobId Job identifier
     */
    function getJob(Jobs storage self, uint256 _jobId) constant returns (uint256, bytes32, uint256, address, address, uint256) {
        // Check for valid job id
        if (_jobId >= self.numJobs) throw;

        Job job = self.jobs[_jobId];

        return (job.jobId,
                job.transcodingOptions,
                job.maxPricePerSegment,
                job.broadcasterAddress,
                job.transcoderAddress,
                job.endBlock
                );
    }

    /*
     * Return a job's transcode claims details
     * Note: getJob() cannot return all the fields for a job because Solidity will complain with "Stack too deep, try removing local variables"
     * Thus, getJob() returns some fields for a job and this function returns fields for a job only relevant for transcode claims
     * @param self Jobs struct storage receiver
     * @param _jobId Job identifier
     */
    function getJobTranscodeClaimsDetails(Jobs storage self, uint256 _jobId) constant returns (uint256, uint256, uint256, uint256, bytes32) {
        // Check for valid job id
        if (_jobId >= self.numJobs) throw;

        Job job = self.jobs[_jobId];

        return (job.lastClaimedWorkBlock,
                job.endVerificationBlock,
                job.lastClaimedSegmentRange[0],
                job.lastClaimedSegmentRange[1],
                job.lastTranscodeClaimsRoot
                );
    }

    /*
     * End a job. Can be called by either a broadcaster or transcoder of a job
     * @param self Jobs struct storage receiver
     * @param _jobId Job identifier
     * @param _jobEndingPeriod Time between when this function is called and when the job is considered inactive. Denominated in blocks
     */
    function endJob(Jobs storage self, uint256 _jobId, uint256 _jobEndingPeriod) returns (bool) {
        // Check for valid job id
        if (_jobId >= self.numJobs) throw;
        // Check if job already has an end block
        if (self.jobs[_jobId].endBlock > 0) throw;
        // Check if called by either broadcaster or transcoder
        if (msg.sender != self.jobs[_jobId].broadcasterAddress && msg.sender != self.jobs[_jobId].transcoderAddress) throw;

        // Set end block for job
        self.jobs[_jobId].endBlock = block.number + _jobEndingPeriod;

        return true;
    }

    /*
     * Submit transcode claims for a range of segments
     * @param self Jobs struct storage receiver
     * @param _jobId Job identifier
     * @param _startSegmentSequenceNumber First segment in the range of transcoded segments
     * @param _endSegmentSequenceNumber Second segment in the range of transcoded segments
     * @param _transcodeClaimRoot Merkle root of transcode claims for the range of segments
     * @param _verificationPeriod Time after this function is called that verify() needs to be called
     */
    function claimWork(Jobs storage self, uint256 _jobId, uint256 _startSegmentSequenceNumber, uint256 _endSegmentSequenceNumber, bytes32 _transcodeClaimsRoot, uint256 _verificationPeriod) returns (bool) {
        // Check for valid job id
        if (_jobId >= self.numJobs) throw;
        // Check if job is active
        if (jobStatus(self, _jobId) != JobStatus.Active) throw;
        // Check if sender is assigned transcoder
        if (self.jobs[_jobId].transcoderAddress != msg.sender) throw;
        // Check if previous verification period over
        // TODO: This function should be able to be called if verification is finished, but the verification period is not over
        if (block.number < self.jobs[_jobId].endVerificationBlock) throw;

        self.jobs[_jobId].lastClaimedSegmentRange[0] = _startSegmentSequenceNumber;
        self.jobs[_jobId].lastClaimedSegmentRange[1] = _endSegmentSequenceNumber;
        self.jobs[_jobId].lastClaimedWorkBlock = block.number;
        self.jobs[_jobId].endVerificationBlock = block.number + _verificationPeriod;
        self.jobs[_jobId].lastTranscodeClaimsRoot = _transcodeClaimsRoot;

        return true;
    }

    /*
     * Validate a transcoder claim
     * @param self Jobs struct storage receiver
     * @param _jobId Job identifier
     * @param _segmentSequenceNumber Segment sequence number in stream
     * @param _dataHash Segment data hash. Used to retrieve segment data from Swarm
     * @param _transcodedDataHash Transcoded segment data hash. Used to retrieve transcoded segment data from Swarm
     * @param _broadcasterSig Broadcaster's signature over segment
     * @param _proof Merkle proof for the signed transcode claim
     * @param _verificationRate % of segments to be verified
     */
    function validateTranscoderClaim(Jobs storage self,
                                     uint256 _jobId,
                                     uint256 _segmentSequenceNumber,
                                     bytes32 _dataHash, bytes32 _transcodedDataHash,
                                     bytes _broadcasterSig,
                                     bytes _proof,
                                     uint64 _verificationRate) constant returns (bool) {
        // Check for valid job id
        if (_jobId >= self.numJobs) throw;
        // Check if job is active
        if (jobStatus(self, _jobId) != JobStatus.Active) return false;
        // Check if sender is the assigned transcoder
        if (self.jobs[_jobId].transcoderAddress != msg.sender) return false;
        // Check if segment is eligible for verification
        if (!shouldVerifySegment(_segmentSequenceNumber,
                                 self.jobs[_jobId].lastClaimedSegmentRange[0],
                                 self.jobs[_jobId].lastClaimedSegmentRange[1],
                                 self.jobs[_jobId].lastClaimedWorkBlock,
                                 block.blockhash(self.jobs[_jobId].lastClaimedWorkBlock),
                                 _verificationRate
                                 )) return false;
        // Check if segment was signed by broadcaster
        if (!ECVerify.ecverify(segmentHash(self.jobs[_jobId].streamId, _segmentSequenceNumber, _dataHash),
                               _broadcasterSig,
                               self.jobs[_jobId].broadcasterAddress)) return false;
        // Check if transcode claim is included in the Merkle root submitted during the last call to claimWork()
        if (!MerkleProof.verifyProof(_proof,
                                     self.jobs[_jobId].lastTranscodeClaimsRoot,
                                     transcodeClaimHash(self.jobs[_jobId].streamId, _segmentSequenceNumber, _dataHash, _transcodedDataHash, _broadcasterSig))) return false;

        return true;
    }

    /*
     * Computes whether a segment is eligible for verification based on the last call to claimWork()
     * @param _segmentSequenceNumber Sequence number of segment in stream
     * @param _startSegmentSequenceNumber Sequence number of first segment claimed
     * @param _endSegmentSequenceNumber Sequence number of last segment claimed
     * @param _lastClaimedWorkBlock Block number when claimWork() was last called
     * @param _lastClaimedWorkBlockHash Block hash when claimWork() was last called
     * @param _verificationRate Rate at which a particular segment should be verified
     */
    function shouldVerifySegment(uint256 _segmentSequenceNumber,
                                 uint256 _startSegmentSequenceNumber,
                                 uint256 _endSegmentSequenceNumber,
                                 uint256 _lastClaimedWorkBlock,
                                 bytes32 _lastClaimedWorkBlockHash,
                                 uint64 _verificationRate) constant returns (bool) {
        // Check if segment is in last claimed segment range
        if (_segmentSequenceNumber < _startSegmentSequenceNumber || _segmentSequenceNumber > _endSegmentSequenceNumber) return false;

        if (uint256(keccak256(_lastClaimedWorkBlock, _lastClaimedWorkBlockHash, _segmentSequenceNumber)) % _verificationRate == 0) {
            return true;
        } else {
            return false;
        }
    }

    /*
     * Compute the hash of a segment
     * @param _streamId Stream identifier
     * @param _segmentSequenceNumber Segment sequence number in stream
     * @param _dataHash Segment data hash
     */
    function segmentHash(string _streamId, uint256 _segmentSequenceNumber, bytes32 _dataHash) internal constant returns (bytes32) {
        return keccak256(_streamId, _segmentSequenceNumber, _dataHash);
    }

    /*
     * Compute the hash of a transcode claim
     * @param _streamId Stream identifier
     * @param _segmentSequenceNumber Segment sequence number in stream
     * @param _dataHash Segment data hash
     * @param _transcodedDataHash Transcoded segment data hash
     * @param _broadcasterSig Broadcaster's signature over segment
     */
    function transcodeClaimHash(string _streamId, uint256 _segmentSequenceNumber, bytes32 _dataHash, bytes32 _transcodedDataHash, bytes _broadcasterSig) internal constant returns (bytes32) {
        return keccak256(_streamId, _segmentSequenceNumber, _dataHash, _transcodedDataHash, _broadcasterSig);
    }
}
