pragma solidity ^0.4.25;
// solium-disable-next-line
pragma experimental ABIEncoderV2;

import "../../pm/ReserveLib.sol";


contract PublicReserveLib {
    using ReserveLib for ReserveLib.ReserveManager;

    ReserveLib.ReserveManager internal manager;

    event Claimed(address claimant, uint256 amount);

    function fund(uint256 _amount) external {
        manager.fund(_amount);
    }

    function clear() external {
        manager.clear();
    }

    function freeze(uint256 _freezeRound, uint256 _recipientsInFreezeRound) external {
        manager.freeze(_freezeRound, _recipientsInFreezeRound);
    }

    function claim(address _claimant, uint256 _amount) external {
        uint256 res = manager.claim(_claimant, _amount);

        // Emit an event with the result from manager.claim()
        // for testing purposes
        emit Claimed(_claimant, res);
    }

    function claimed(address _claimant) public view returns (uint256) {
        return manager.claimed(_claimant);
    }

    function fundsRemaining() public view returns (uint256) {
        return manager.fundsRemaining();
    }

    function isFrozen() public view returns (bool) {
        return manager.isFrozen();
    }

    function getReserveNonce() public view returns (uint256) {
        return manager.reserveNonce;
    }

    function getReserve() public view returns (ReserveLib.Reserve memory) {
        return manager.reserve;
    }
}