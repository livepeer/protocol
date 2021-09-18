pragma solidity 0.8.4;
import "./GenericMock.sol";

contract StakingManagerMock is GenericMock {
    event UpdateOrchestratorWithFees(address orchestrator, uint256 fees);

    function updateOrchestratorWithFees(address _orchestrator, uint256 _fees) external {
        emit UpdateOrchestratorWithFees(_orchestrator, _fees);
    }
}