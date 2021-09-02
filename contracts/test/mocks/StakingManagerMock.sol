pragma solidity 0.8.4;
import "./GenericMock.sol";

contract StakingManagerMock is GenericMock {
    event UpdateOrchestratorWithFees(address transcoder, uint256 fees);

    function updateOrchestratorWithFees(
        address _transcoder,
        uint256 _fees
    ) external {
        emit UpdateOrchestratorWithFees(_transcoder, _fees);
    }
}
