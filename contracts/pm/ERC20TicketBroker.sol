pragma solidity ^0.4.25;
// solium-disable-next-line
pragma experimental ABIEncoderV2;

import "./TicketBroker.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";


// JUST AN EXAMPLE
contract ERC20TicketBroker is TicketBroker {
    ERC20 public token;

    constructor(
        address _token,
        uint256 _unlockPeriod,
        uint256 _signerRevocationPeriod
    )
        TicketBroker(_unlockPeriod, _signerRevocationPeriod)
        public
    {
        token = ERC20(_token);
    }

    // For ERC20
    function fundDeposit(uint256 _amount)
        external
        processDeposit(msg.sender, _amount)
    {
        processFunding(_amount);
    }

    function fundReserve(uint256 _amount)
        external
        processReserve(msg.sender, _amount)
    {
        processFunding(_amount);
    }

    function fundAndApproveSigners(
        uint256 _depositAmount,
        uint256 _reserveAmount,
        address[] _signers
    )
        external
        payable
        processDeposit(msg.sender, _depositAmount)
        processReserve(msg.sender, _reserveAmount)
    {
        approveSigners(_signers);
        processFunding(_depositAmount.add(_reserveAmount));
    }

    function processFunding(uint256 _amount) internal {
        require(msg.value == 0, "ETH funding not supported. Please use an ERC20 token instead.");
        require(
            token.transferFrom(msg.sender, address(this), _amount),
            "token transfer failed"
        );
    }

    function withdrawTransfer(address _sender, uint256 _amount) internal {
        token.transfer(_sender, _amount);
    }

    function winningTicketTransfer(address _recipient, uint256 _amount) internal {
        token.transfer(_recipient, _amount);
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
        // TODO: add ERC20TicketBroker specific logic for claiming from reserve
        return 0;
    }
}