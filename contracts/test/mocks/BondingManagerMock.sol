pragma solidity 0.8.4;
import "./GenericMock.sol";

contract BondingManagerMock is GenericMock {
    event UpdateOrchestratorWithFees(address transcoder, uint256 fees, uint256 round);

    function updateOrchestratorWithFees(
        address _transcoder,
        uint256 _fees,
        uint256 _round
    ) external {
        emit UpdateOrchestratorWithFees(_transcoder, _fees, _round);
    }
}
