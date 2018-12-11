pragma solidity ^0.4.25;
// solium-disable-next-line
pragma experimental ABIEncoderV2;

import "../ManagerProxyTarget.sol";
import "../token/IMinter.sol";
import "../bonding/IBondingManager.sol";
import "../rounds/IRoundsManager.sol";
import "./TicketBroker.sol";


contract LivepeerETHTicketBroker is ManagerProxyTarget, TicketBroker {
    constructor(
        address _controller,
        uint256 _minPenaltyEscrow,
        uint256 _unlockPeriod
    ) 
        Manager(_controller)
        // TODO: Consider using a initializer instead of an
        // explicit constructor in base TicketBroker since
        // upgradeable proxies do not use explicit constructors
        TicketBroker(_minPenaltyEscrow, _unlockPeriod)
        public
    {}

    function setMinPenaltyEscrow(uint256 _minPenaltyEscrow) external onlyControllerOwner {
        minPenaltyEscrow = _minPenaltyEscrow;
    }

    function setUnlockPeriod(uint256 _unlockPeriod) external onlyControllerOwner {
        unlockPeriod = _unlockPeriod;
    }

    function processDeposit(uint256 _amount) internal {
        minter().trustedDepositETH.value(_amount)();
    }

    function processPenaltyEscrow(uint256 _amount) internal {
        minter().trustedDepositETH.value(_amount)();
    }

    function withdrawTransfer(address _sender, uint256 _amount) internal {
        minter().trustedWithdrawETH(_sender, _amount);
    }

    function winningTicketTransfer(address _recipient, uint256 _amount) internal {
        // TODO: Consider changing this to the ticket creation round
        uint256 currentRound = roundsManager().currentRound();

        bondingManager().updateTranscoderWithFees(
            _recipient,
            _amount,
            currentRound
        );
    }

    function penaltyEscrowSlash(uint256 _amount) internal {
        minter().trustedBurnETH(_amount);
    }

    // TODO: Stub for tests. Change to Livepeer specific logic
    function requireValidTicketAuxData(bytes _auxData) internal view {
        require(
            getCreationTimestamp(_auxData) + 3 days > block.timestamp,
            "ticket is expired"
        );
    }

    function minter() internal view returns (IMinter) {
        return IMinter(controller.getContract(keccak256("Minter")));
    }

    function bondingManager() internal view returns (IBondingManager) {
        return IBondingManager(controller.getContract(keccak256("BondingManager")));
    }

    function roundsManager() internal view returns (IRoundsManager) {
        return IRoundsManager(controller.getContract(keccak256("RoundsManager")));
    }

    // TODO: Stub for tests. Change to Livepeer specific logic
    function getCreationTimestamp(bytes _auxData) internal pure returns (uint256 creationTimestamp) {
        assembly {
            creationTimestamp := mload(add(_auxData, 32))
        }
    }
}

