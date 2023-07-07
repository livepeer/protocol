// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../Manager.sol";
import "../bonding/IBondingCheckpoints.sol";
import "./GovernorCountingOverridable.sol";

/**
 * @title Interface for BondingCheckpoints
 */
contract BondingCheckpointsVotes is Manager, IVotes {
    constructor(address _controller) Manager(_controller) {}

    /**
     * @notice Clock is set to match the current round, which is the checkpointing
     *  method implemented here.
     */
    function clock() public view returns (uint48) {
        return bondingCheckpoints().clock();
    }

    /**
     * @notice Machine-readable description of the clock as specified in EIP-6372.
     */
    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE() public view returns (string memory) {
        return bondingCheckpoints().CLOCK_MODE();
    }

    /**
     * @notice Returns the current amount of votes that `account` has.
     */
    function getVotes(address _account) external view returns (uint256) {
        return bondingCheckpoints().getAccountStakeAt(_account, clock());
    }

    /**
     * @notice Returns the amount of votes that `account` had at a specific moment in the past. If the `clock()` is
     * configured to use block numbers, this will return the value at the end of the corresponding block.
     */
    function getPastVotes(address _account, uint256 _timepoint) external view returns (uint256) {
        return bondingCheckpoints().getAccountStakeAt(_account, _timepoint);
    }

    /**
     * @notice Returns the total supply of votes available at a specific round in the past.
     * @dev This value is the sum of all *active* stake, which is not necessarily the sum of all voting power.
     * Bonded stake that is not part of the top 100 active transcoder set is still given voting power, but is not
     * considered here.
     */
    function getPastTotalSupply(uint256 _timepoint) external view returns (uint256) {
        return bondingCheckpoints().getTotalActiveStakeAt(_timepoint);
    }

    /**
     * @notice Returns the delegate that _account has chosen. This means the delegated transcoder address in case of
     * delegators, and the account own address for transcoders (self-delegated).
     */
    function delegates(address _account) external view returns (address) {
        return delegatedAt(_account, clock());
    }

    /**
     * @notice Returns the delegate that _account had chosen in a specific round in the past. See `delegates()` above
     * for more details.
     * @dev This is an addition to the IERC5805 interface to support our custom vote counting logic that allows
     * delegators to override their transcoders votes. See {GovernorVotesBondingCheckpoints-_handleVoteOverrides}.
     */
    function delegatedAt(address _account, uint256 _round) public view returns (address) {
        return bondingCheckpoints().getDelegateAddressAt(_account, _round);
    }

    /**
     * @notice Delegation through BondingCheckpoints is not supported.
     */
    function delegate(address) external pure {
        revert("use BondingManager to update vote delegation through bonding");
    }

    /**
     * @notice Delegation through BondingCheckpoints is not supported.
     */
    function delegateBySig(
        address,
        uint256,
        uint256,
        uint8,
        bytes32,
        bytes32
    ) external pure {
        revert("use BondingManager to update vote delegation through bonding");
    }

    /**
     * @dev Returns the BondingCheckpoints contract.
     */
    function bondingCheckpoints() internal view returns (IBondingCheckpoints) {
        return IBondingCheckpoints(controller.getContract(keccak256("BondingCheckpoints")));
    }
}
