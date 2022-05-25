// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./Poll.sol";

interface IBondingManager {
    function transcoderTotalStake(address _addr) external view returns (uint256);

    function pendingStake(address _addr, uint256 _endRound) external view returns (uint256);
}

contract PollCreator {
    // 33.33%
    uint256 public constant QUORUM = 333300;
    // 50%
    uint256 public constant QUOTA = 500000;
    // 10 rounds
    uint256 public constant POLL_PERIOD = 10 * 5760;
    uint256 public constant POLL_CREATION_COST = 100 * 1 ether;

    IBondingManager public bondingManager;

    event PollCreated(address indexed poll, bytes proposal, uint256 endBlock, uint256 quorum, uint256 quota);

    constructor(address _bondingManagerAddr) {
        bondingManager = IBondingManager(_bondingManagerAddr);
    }

    /**
     * @notice Create a poll if caller has POLL_CREATION_COST LPT stake (own stake or stake delegated to it).
     * @param _proposal The IPFS multihash for the proposal.
     */
    function createPoll(bytes calldata _proposal) external {
        require(
            // pendingStake() ignores the second arg
            bondingManager.pendingStake(msg.sender, 0) >= POLL_CREATION_COST ||
                bondingManager.transcoderTotalStake(msg.sender) >= POLL_CREATION_COST,
            "PollCreator#createPoll: INSUFFICIENT_STAKE"
        );

        uint256 endBlock = block.number + POLL_PERIOD;
        Poll poll = new Poll(endBlock);

        emit PollCreated(address(poll), _proposal, endBlock, QUORUM, QUOTA);
    }
}
