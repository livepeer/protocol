pragma solidity ^0.4.25;

import "./GenericMock.sol";

contract BondingManagerMock is GenericMock {

    event UpdateTranscoderWithFees(address transcoder, uint256 fees, uint256 round);

    function updateTranscoderWithFees(
        address _transcoder,
        uint256 _fees,
        uint256 _round
    )
        external
    {
        emit UpdateTranscoderWithFees(_transcoder, _fees, _round);
    }
}