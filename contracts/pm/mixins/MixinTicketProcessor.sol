pragma solidity ^0.4.25;

import "./interfaces/MTicketProcessor.sol";
import "./interfaces/MContractRegistry.sol";


contract MixinTicketProcessor is MContractRegistry, MTicketProcessor {
    /**
     * @dev Process sent funds.
     * @param _amount Amount of funds sent
     */
    function processFunding(uint256 _amount) internal {
        // Send funds to Minter
        minter().trustedDepositETH.value(_amount)();
    }

    /**
     * @dev Transfer withdrawal funds for a ticket sender
     * @param _amount Amount of withdrawal funds
     */
    function withdrawTransfer(address _sender, uint256 _amount) internal {
        // Ask Minter to send withdrawal funds to the ticket sender
        minter().trustedWithdrawETH(_sender, _amount);
    }

    /**
     * @dev Transfer funds for a recipient's winning ticket
     * @param _recipient Address of recipient
     * @param _amount Amount of funds for the winning ticket
     */
    function winningTicketTransfer(address _recipient, uint256 _amount) internal {
        // TODO: Consider changing this to the ticket creation round
        uint256 currentRound = roundsManager().currentRound();

        // Ask BondingManager to update fee pool for recipient with
        // winning ticket funds
        bondingManager().updateTranscoderWithFees(
            _recipient,
            _amount,
            currentRound
        );
    }

    /**
     * @dev Validates a ticket's auxilary data (succeeds or reverts)
     * @param _auxData Auxilary data inclueded in a ticket
     */
    function requireValidTicketAuxData(bytes _auxData) internal view {
        // TODO: Stub for tests. Change to Livepeer specific logic
    }
}