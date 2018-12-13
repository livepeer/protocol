pragma solidity ^0.4.25;
// solium-disable-next-line
pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "./TicketBroker.sol";


// JUST AN EXAMPLE
contract ERC20TicketBroker is TicketBroker {
    ERC20 public token;

    constructor(
        address _token, 
        uint256 _minPenaltyEscrow,
        uint256 _unlockPeriod,
        uint256 _signerRevocationPeriod 
    )
        TicketBroker(_minPenaltyEscrow, _unlockPeriod, _signerRevocationPeriod)
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

    function fundPenaltyEscrow(uint256 _amount) 
        external
        processPenaltyEscrow(msg.sender, _amount)
    {
        processFunding(_amount);
    }

    function fundAndApproveSigners(
        uint256 _depositAmount,
        uint256 _penaltyEscrowAmount,
        address[] _signers
    )
        external
        payable
        processDeposit(msg.sender, _depositAmount)
        processPenaltyEscrow(msg.sender, _penaltyEscrowAmount)
    {
        approveSigners(_signers);
        processFunding(_depositAmount + _penaltyEscrowAmount);
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

    function penaltyEscrowSlash(uint256 _amount) internal {
        token.transfer(address(0), _amount);
    }
}