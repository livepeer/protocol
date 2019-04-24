pragma solidity ^0.4.25;
// solium-disable-next-line
pragma experimental ABIEncoderV2;

import "../../pm/ReserveLib.sol";


contract PublicReserveLib {
    using ReserveLib for ReserveLib.ReserveManager;

    ReserveLib.ReserveManager internal manager;

    function fund(uint256 _amount) external {
        manager.fund(_amount);
    }

    function clear() external {
        manager.clear();
    }

    function fundsRemaining() public view returns (uint256) {
        return manager.fundsRemaining();
    }

    function getReserveNonce() public view returns (uint256) {
        return manager.reserveNonce;
    }

    function getReserve() public view returns (ReserveLib.Reserve memory) {
        return manager.reserve;
    }
}