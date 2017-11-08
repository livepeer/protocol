pragma solidity ^0.4.17;

import "./MinHeap.sol";
import "./MaxHeap.sol";


library TranscoderPools {
    using MinHeap for MinHeap.Heap;
    using MaxHeap for MaxHeap.Heap;

    struct TranscoderPools {
        MinHeap.Heap candidateTranscoders;
        MaxHeap.Heap reserveTranscoders;
    }

    /*
     * Initializes transcoder pools with maximum sizes
     * @param _candidatePoolSize Max size of active pool
     * @param _reservePoolSize Max size of candidate pool
     */
    function init(TranscoderPools storage self, uint256 _candidatePoolSize, uint256 _reservePoolSize) {
        self.candidateTranscoders.init(_candidatePoolSize);
        self.reserveTranscoders.init(_reservePoolSize);
    }

    /*
     * Checks if transcoder is in a pool
     * @param _transcoder Address of transcoder
     */
    function isInPools(TranscoderPools storage self, address _transcoder) view returns (bool) {
        return self.candidateTranscoders.ids[_transcoder] || self.reserveTranscoders.ids[_transcoder];
    }

    /*
     * Checks if transcoder is in active pool
     * @param _transcoder Address of transcoder
     */
    function isCandidateTranscoder(TranscoderPools storage self, address _transcoder) view returns (bool) {
        return self.candidateTranscoders.ids[_transcoder];
    }

    /*
     * Checks if transcoder is in candidate pool
     */
    function isReserveTranscoder(TranscoderPools storage self, address _transcoder) view returns (bool) {
        return self.reserveTranscoders.ids[_transcoder];
    }

    /*
     * Returns address of candidate transcoder at a position in the heap
     * @param _position Position in candidate transcoder heap
     */
    function getCandidateTranscoderAtPosition(TranscoderPools storage self, uint256 _position) view returns (address) {
        return self.candidateTranscoders.nodes[_position].id;
    }

    /*
     * Returns address of reserve transcoder at a position in the heap
     * @param _position Position in reserve transcoder heap
     */
    function getReserveTranscoderAtPosition(TranscoderPools storage self, uint256 _position) view returns (address) {
        return self.reserveTranscoders.nodes[_position].id;
    }

    /*
     * Returns current size of candidate pool
     */
    function getCandidatePoolSize(TranscoderPools storage self) view returns (uint256) {
        return self.candidateTranscoders.nodes.length;
    }

    /*
     * Returns current size of reserve pool
     */
    function getReservePoolSize(TranscoderPools storage self) view returns (uint256) {
        return self.reserveTranscoders.nodes.length;
    }

    /*
     * Adds a transcoder to a pool. Throws if transcoder is already in a pool
     * @param _transcoder Address of transcoder
     * @param _amount The cumulative amount of LPT bonded to the transcoder
     */
    function addTranscoder(TranscoderPools storage self, address _transcoder, uint256 _amount) returns (bool) {
        // Check if transcoder is already in a pool
        require(!self.candidateTranscoders.ids[_transcoder] && !self.reserveTranscoders.ids[_transcoder]);

        if (!self.candidateTranscoders.isFull()) {
            // Candidate transcoder pool is not full
            // Insert transcoder
            self.candidateTranscoders.insert(_transcoder, _amount);
        } else {
            // Candidate transcoder pool is full

            var (minCandidate, minCandidateStake) = self.candidateTranscoders.min();

            if (_amount > minCandidateStake) {
                // New transcoder stake is greater than stake of candidate transcoder with smallest stake
                // Remove candidate transcoder with smallest stake from candidate transcoder pool
                self.candidateTranscoders.extractMin();
                // Insert new transcoder into active transcoder pool
                self.candidateTranscoders.insert(_transcoder, _amount);

                if (self.reserveTranscoders.isEmpty()) {
                    // Insert candidate transcoder with smallest stake into reserve pool
                    self.reserveTranscoders.insert(minCandidate, minCandidateStake);
                } else {
                    var (, maxReserveStake) = self.reserveTranscoders.max();

                    if (minCandidateStake >= maxReserveStake) {
                        // Stake of former candidate transcoder with smallest stake greater than
                        // or equal to stake of reserve transcoder with greatest stake.
                        // Favor the former candidate transcoder if stake is equal
                        // Remove reserve transcoder with greatest stake
                        self.reserveTranscoders.extractMax();
                        // Insert former candidate transcoder with smallest stake
                        self.reserveTranscoders.insert(minCandidate, minCandidateStake);
                    }
                }
            } else if (!self.reserveTranscoders.isFull()) {
                // Reserve pool is not full
                // Insert transcoder
                self.reserveTranscoders.insert(_transcoder, _amount);
            } else {
                // Cannot add transcoder if both pools are full
                revert();
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
        if (self.candidateTranscoders.ids[_transcoder]) {
            // Transcoder in candidate pool
            // Increase key
            self.candidateTranscoders.increaseKey(_transcoder, _amount);
        } else if (self.reserveTranscoders.ids[_transcoder]) {
            // Transcoder in reserve pool
            // Increase key
            self.reserveTranscoders.increaseKey(_transcoder, _amount);
            // Review reserve transcoder for promotion
            // Get reserve transcoder with highest stake
            var (maxReserve, maxReserveStake) = self.reserveTranscoders.max();

            if (_transcoder == maxReserve) {
                // Transcoder with increased stake is now reserve transcoder with highest stake
                // Get candidate transcoder with smallest stake
                var (minCandidate, minCandidateStake) = self.candidateTranscoders.min();

                if (maxReserveStake > minCandidateStake) {
                    // Transcoder with increased stake has greater stake than candidate transcoder with smallest stake
                    // Remove candidate transcoder with smallest stake from candidate pool
                    self.candidateTranscoders.extractMin();
                    // Add transcoder with increased stake to candidate transcoder pool
                    self.candidateTranscoders.insert(maxReserve, maxReserveStake);
                    // Remove transcoder with increased stake from reserve transcoder pool
                    self.reserveTranscoders.extractMax();
                    // Add candidate transcoder with smallest stake to reserve transcoder pool
                    self.reserveTranscoders.insert(minCandidate, minCandidateStake);
                }
            }
        } else {
            // Transcoder is in neither pool
            revert();
        }

        return true;
    }

    /*
     * Removes transcoder from pools
     * @param _transcoder Address of transcoder
     */
    function removeTranscoder(TranscoderPools storage self, address _transcoder) returns (bool) {
        if (self.candidateTranscoders.ids[_transcoder]) {
            // Transcoder in candidate transcoder pool
            // Remove transcoder from active pool
            self.candidateTranscoders.deleteId(_transcoder);

            if (!self.reserveTranscoders.isEmpty()) {
                // Promote the reserve transcoder with the greatest stake
                var (maxReserve, maxReserveStake) = self.reserveTranscoders.max();
                self.reserveTranscoders.extractMax();
                self.candidateTranscoders.insert(maxReserve, maxReserveStake);
            }
        } else if (self.reserveTranscoders.ids[_transcoder]) {
            // Transcoder in reserve transcoder pool
            // Remove transcoder from reserve pool
            self.reserveTranscoders.deleteId(_transcoder);
        } else {
            // Transcoder not in either pool
            revert();
        }

        return true;
    }

    /*
     * Decreases the cumulative stake of a transcoder in a pool
     * @param _transcoder Address of transcoder
     * @param _amount The amount of LPT to subtract from the cumulative stake of transcoder
     */
    function decreaseTranscoderStake(TranscoderPools storage self, address _transcoder, uint256 _amount) returns (bool) {
        if (self.candidateTranscoders.ids[_transcoder]) {
            // Transcoder in candidate transcoder pool
            // Decrease key
            self.candidateTranscoders.decreaseKey(_transcoder, _amount);
            // Review candidate transcoder for demotion
            // Get candidate transcoder with smallest stake
            var (minCandidate, minCandidateStake) = self.candidateTranscoders.min();

            if (!self.reserveTranscoders.isEmpty() && _transcoder == minCandidate) {
                // Transcoder with decreased stake is now candidate transcoder with smallest stake
                // Get reserve transcoder with largest stake
                var (maxReserve, maxReserveStake) = self.reserveTranscoders.max();

                if (minCandidateStake < maxReserveStake) {
                    // Transcoder with decreased stake has less stake than reserve transcoder with largest stake
                    // Remove transcoder with decreased stake from candidate transcoder pool
                    self.candidateTranscoders.extractMin();
                    // Add reserve transcoder with largest stake to candidate transcoder pool
                    self.candidateTranscoders.insert(maxReserve, maxReserveStake);
                    // Remove reserve transcoder with largest stake from reserve transcoder pool
                    self.reserveTranscoders.extractMax();
                    // Add transcoder with decreased stake to reserve transcoder pool
                    self.reserveTranscoders.insert(minCandidate, minCandidateStake);
                }
            }
        } else if (self.reserveTranscoders.ids[_transcoder]) {
            // Transcoder in reserve transcoder pool
            // Decrease key
            self.reserveTranscoders.decreaseKey(_transcoder, _amount);
        } else {
            // Transcoder not in either transcoder pool
            revert();
        }

        return true;
    }

    /*
     * Return cumulative stake of transcoder
     * @param _transcoder Address of transcoder
     */
    function transcoderStake(TranscoderPools storage self, address _transcoder) view returns (uint256) {
        if (self.candidateTranscoders.ids[_transcoder]) {
            // Transcoder in candidate pool
            return self.candidateTranscoders.getKey(_transcoder);
        } else if (self.reserveTranscoders.ids[_transcoder]) {
            // Transcoder in reserve pool
            return self.reserveTranscoders.getKey(_transcoder);
        } else {
            // Transcoder not in either pool
            revert();
        }
    }
}
