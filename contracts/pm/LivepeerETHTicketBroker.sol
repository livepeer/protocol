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
        uint256 _unlockPeriod,
        uint256 _freezePeriod,
        uint256 _signerRevocationPeriod
    )
        Manager(_controller)
        // TODO: Consider using a initializer instead of an
        // explicit constructor in base TicketBroker since
        // upgradeable proxies do not use explicit constructors
        TicketBroker(_unlockPeriod, _freezePeriod, _signerRevocationPeriod)
        public
    {}

    function setUnlockPeriod(uint256 _unlockPeriod) external onlyControllerOwner {
        unlockPeriod = _unlockPeriod;
    }

    function setFreezePeriod(uint256 _freezePeriod) external onlyControllerOwner {
        freezePeriod = _freezePeriod;
    }

    function setSignerRevocationPeriod(uint256 _signerRevocationPeriod) external onlyControllerOwner {
        signerRevocationPeriod = _signerRevocationPeriod;
    }

    function processFunding(uint256 _amount) internal {
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

    function claimFromReserve(
        ReserveLib.ReserveManager storage manager,
        address _sender,
        address _recipient,
        uint256 _amount
    )
        internal
        returns (uint256)
    {
        if (!manager.isFrozen()) {
            uint256 freezeRound = roundsManager().currentRound();
            // TODO: make sure bondingManager.getTranscoderPoolSize()
            // returns the locked in # registered for the freeze round
            uint256 recipientsInFreezeRound = bondingManager().getTranscoderPoolSize();

            manager.freeze(freezeRound, recipientsInFreezeRound);

            emit ReserveFrozen(
                _sender,
                _recipient,
                freezeRound,
                recipientsInFreezeRound,
                manager.reserve.fundsAdded
            );
        }

        // TODO: consider just checking if recipient is registered
        // in current round vs. keeping track of all rounds that recipient
        // is registered in and checking if recipient was registered
        // during the freeze round (could be in the past)
        if (!bondingManager().isRegisteredTranscoder(_recipient)) {
            return 0;
        }

        uint256 claimAmount = manager.claim(_recipient, _amount);

        emit ReserveClaimed(_sender, _recipient, claimAmount);

        return claimAmount;
    }

    // TODO: Stub for tests. Change to Livepeer specific logic
    function requireValidTicketAuxData(bytes _auxData) internal view {}

    function requireValidFrozenReserveWithdrawal(ReserveLib.ReserveManager storage manager) internal view {
        require(
            manager.reserve.freezeRound.add(freezePeriod) <= roundsManager().currentRound(),
            "sender's reserve is frozen and freeze period is not over"
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
}

