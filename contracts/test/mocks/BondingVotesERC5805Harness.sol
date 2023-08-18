// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../../bonding/BondingVotes.sol";
import "./GenericMock.sol";

/**
 * @dev This is a tets utility for unit tests on the ERC5805 functions of the BondingVotes contract. It overrides the
 * functions that should be used to derive the values returned by the ERC5805 functions and checks against those.
 */
contract BondingVotesERC5805Harness is BondingVotes {
    constructor(address _controller) BondingVotes(_controller) {}

    /**
     * @dev Mocked version that returns transformed version of the input for testing.
     * @return amount lowest 4 bytes of address + _round
     * @return delegateAddress (_account << 4) | _round.
     */
    function getBondingStateAt(address _account, uint256 _round)
        public
        pure
        override
        returns (uint256 amount, address delegateAddress)
    {
        uint160 intAddr = uint160(_account);

        amount = (intAddr & 0xffffffff) + _round;
        delegateAddress = address((intAddr << 4) | uint160(_round));
    }

    function getTotalActiveStakeAt(uint256 _round) public pure override returns (uint256) {
        return 4 * _round;
    }
}
