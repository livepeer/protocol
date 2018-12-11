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
        uint256 _unlockPeriod
    )
        TicketBroker(_minPenaltyEscrow, _unlockPeriod)
        public
    {
        token = ERC20(_token);
    }

    // For ETH
    function fundDeposit() external payable {
        require(false, "ETH funding not supported. Please use an ERC20 token instead.");
    }

    function fundPenaltyEscrow() external payable {
        require(false, "ETH funding not supported. Please use an ERC20 token instead.");
    }

    // For ERC20
    function fundDeposit(uint256 _amount) external {
        _fundDeposit(_amount);
    }

    function fundPenaltyEscrow(uint256 _amount) external {
        _fundPenaltyEscrow(_amount);
    }

    function fundAndApproveSigners(
        uint256 _depositAmount,
        uint256 _penaltyEscrowAmount,
        address[] _signers
    )
        external
        payable
    {
        _fundDeposit(_depositAmount);
        _fundPenaltyEscrow(_penaltyEscrowAmount);
        approveSigners(_signers);
    }

    function processDeposit(uint256 _amount) internal {
        require(
            token.transferFrom(msg.sender, address(this), _amount),
            "token transfer for deposit failed"
        );
    }

    function processPenaltyEscrow(uint256 _amount) internal {
        require(
            token.transferFrom(msg.sender, address(this), _amount),
            "token transfer for penalty escrow failed"
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