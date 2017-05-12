pragma solidity ^0.4.8;

import "./MinHeap.sol";
import "./MaxHeap.sol";

library TranscoderPools {
    using MinHeap for MinHeap.Heap;
    using MaxHeap for MaxHeap.Heap;

    struct TranscoderPools {
        MinHeap.Heap activeTranscoders;
        MaxHeap.Heap candidateTranscoders;
    }

    /*
     * Initializes transcoder pools with maximum sizes
     * @param _activePoolSize Max size of active pool
     * @param _candidatePoolSize Max size of candidate pool
     */
    function init(TranscoderPools storage self, uint256 _activePoolSize, uint256 _candidatePoolSize) {
        self.activeTranscoders.init(_activePoolSize);
        self.candidateTranscoders.init(_candidatePoolSize);
    }

    /*
     * Checks if transcoder is in a pool
     * @param _transcoder Address of transcoder
     */
    function isInPools(TranscoderPools storage self, address _transcoder) constant returns (bool) {
        return self.activeTranscoders.ids[_transcoder] || self.candidateTranscoders.ids[_transcoder];
    }

    /*
     * Checks if transcoder is in active pool
     * @param _transcoder Address of transcoder
     */
    function isActiveTranscoder(TranscoderPools storage self, address _transcoder) constant returns (bool) {
        return self.activeTranscoders.ids[_transcoder];
    }

    /*
     * Checks if transcoder is in candidate pool
     */
    function isCandidateTranscoder(TranscoderPools storage self, address _transcoder) constant returns (bool) {
        return self.candidateTranscoders.ids[_transcoder];
    }

    /*
     * Adds a transcoder to a pool. Throws if transcoder is already in a pool
     * @param _transcoder Address of transcoder
     * @param _amount The cumulative amount of LPT bonded to the transcoder
     */
    function addTranscoder(TranscoderPools storage self, address _transcoder, uint256 _amount) returns (bool) {
        // Check if transcoder is already in a pool
        if (self.activeTranscoders.ids[_transcoder] || self.candidateTranscoders.ids[_transcoder]) throw;

        if (!self.activeTranscoders.isFull()) {
            // Active transcoder pool is not full
            // Insert transcoder
            self.activeTranscoders.insert(_transcoder, _amount);
        } else {
            // Active transcoder pool is full

            var (minActive, minActiveStake) = self.activeTranscoders.min();

            if (_amount > minActiveStake) {
                // New transcoder stake is greater than stake of active transcoder with smallest stake
                // Remove active transcoder with smallest stake from active transcoder pool
                self.activeTranscoders.extractMin();
                // Insert new transcoder into active transcoder pool
                self.activeTranscoders.insert(_transcoder, _amount);

                if (self.candidateTranscoders.isEmpty()) {
                    // Insert active transcoder with smallest stake into candidate pool
                    self.candidateTranscoders.insert(minActive, minActiveStake);
                } else {
                    var (maxCandidate, maxCandidateStake) = self.candidateTranscoders.max();

                    if (minActiveStake >= maxCandidateStake) {
                        // Stake of former active transcoder with smallest stake greater than
                        // or equal to stake of candidate transcoder with greatest stake.
                        // Favor the former active transcoder if stake is equal
                        // Remove candidate transcoder with greatest stake
                        self.candidateTranscoders.extractMax();
                        // Insert former active transcoder with smallest stake
                        self.candidateTranscoders.insert(minActive, minActiveStake);
                    }
                }
            } else if (!self.candidateTranscoders.isFull()) {
                // Candidate transcoder pool is not full
                // Insert transcoder
                self.candidateTranscoders.insert(_transcoder, _amount);
            } else {
                // Cannot add transcoder if both pools are full
                throw;
            }
        }

        return true;
    }

    /*
     * Increases the cumulative stake of a transcoder in a pool
     * @param _transcoder Address of transcoder
     * @param _amount The amount of additional LPT to add to cumulative stake of transcoder
     */
    function increaseTranscoderStake(TranscoderPools storage self, address _transcoder, uint256 _amount) returns (bool) {
        if (self.activeTranscoders.ids[_transcoder]) {
            // Transcoder in active transcoder pool
            // Increase key
            self.activeTranscoders.increaseKey(_transcoder, _amount);
        } else if (self.candidateTranscoders.ids[_transcoder]) {
            // Transcoder in candidate transcoder pool
            // Increase key
            self.candidateTranscoders.increaseKey(_transcoder, _amount);
            // Review candidate transcoder for promotion
            // Get candidate transcoder with highest stake
            var (maxCandidate, maxCandidateStake) = self.candidateTranscoders.max();

            if (_transcoder == maxCandidate) {
                // Transcoder with increased stake is now candidate transcoder with highest stake
                // Get active transcoder with smallest stake
                var (minActive, minActiveStake) = self.activeTranscoders.min();

                if (maxCandidateStake > minActiveStake) {
                    // Transcoder with increased stake has greater stake than active transcoder with smallest stake
                    // Remove active transcoder with smallest stake from active transcoder pool
                    self.activeTranscoders.extractMin();
                    // Add transcoder with increased stake to active transcoder pool
                    self.activeTranscoders.insert(maxCandidate, maxCandidateStake);
                    // Remove transcoder with increased stake from candidate transcoder pool
                    self.candidateTranscoders.extractMax();
                    // Add active transcoder with smallest stake to candidate transcoder pool
                    self.candidateTranscoders.insert(minActive, minActiveStake);
                }
            }
        } else {
            // Transcoder is in neither pool
            throw;
        }

        return true;
    }

    /*
     * Removes transcoder from pools
     * @param _transcoder Address of transcoder
     */
    function removeTranscoder(TranscoderPools storage self, address _transcoder) returns (bool) {
        if (self.activeTranscoders.ids[_transcoder]) {
            // Transcoder in active transcoder pool
            // Remove transcoder from active pool
            self.activeTranscoders.deleteId(_transcoder);

            if (!self.candidateTranscoders.isEmpty()) {
                // Promote the candidate transcoder with the greatest stake
                var (maxCandidate, maxCandidateStake) = self.candidateTranscoders.max();
                self.candidateTranscoders.extractMax();
                self.activeTranscoders.insert(maxCandidate, maxCandidateStake);
            }
        } else if (self.candidateTranscoders.ids[_transcoder]) {
            // Transcoder in candidate transcoder pool
            // Remove transcoder from candidate pool
            self.candidateTranscoders.deleteId(_transcoder);
        } else {
            // Transcoder not in either pool
            throw;
        }

        return true;
    }

    /*
     * Decreases the cumulative stake of a transcoder in a pool
     * @param _transcoder Address of transcoder
     * @param _amount The amount of LPT to subtract from the cumulative stake of transcoder
     */
    function decreaseTranscoderStake(TranscoderPools storage self, address _transcoder, uint256 _amount) returns (bool) {
        if (self.activeTranscoders.ids[_transcoder]) {
            // Transcoder in active transcoder pool
            // Decrease key
            self.activeTranscoders.decreaseKey(_transcoder, _amount);
            // Review active transcoder for demotion
            // Get active transcoder with smallest stake
            var (minT, minStake) = self.activeTranscoders.min();

            if (!self.candidateTranscoders.isEmpty() && _transcoder == minT) {
                // Transcoder with decreased stake is now active transcoder with smallest stake
                // Get candidate transcoder with largest stake
                var (maxT, maxStake) = self.candidateTranscoders.max();

                if (minStake < maxStake) {
                    // Transcoder with decreased stake has less stake than candidate transcoder with largest stake
                    // Remove transcoder with decreased stake from active transcoder pool
                    self.activeTranscoders.extractMin();
                    // Add candidate transcoder with largest stake to active transcoder pool
                    self.activeTranscoders.insert(maxT, maxStake);
                    // Remove candidate transcoder with largest stake from candidate transcoder pool
                    self.candidateTranscoders.extractMax();
                    // Add transcoder with decreased stake to candidate transcoder pool
                    self.candidateTranscoders.insert(minT, minStake);
                }
            }
        } else if (self.candidateTranscoders.ids[_transcoder]) {
            // Transcoder in candidate transcoder pool
            // Decrease key
            self.candidateTranscoders.decreaseKey(_transcoder, _amount);
        } else {
            // Transcoder not in either transcoder pool
            throw;
        }

        return true;
    }
}
