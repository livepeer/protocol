pragma solidity ^0.4.25;


contract MTicketBrokerCore {
    // Emitted when funds are added to a sender's deposit
    event DepositFunded(address indexed sender, uint256 amount);
    // Emitted when a winning ticket is redeemed
    event WinningTicketRedeemed(
        address indexed sender,
        address indexed recipient,
        uint256 faceValue,
        uint256 winProb,
        uint256 senderNonce,
        uint256 recipientRand,
        bytes auxData
    );
    // Emitted when a funds transfer for a winning ticket redemption is executed
    event WinningTicketTransfer(address indexed sender, address indexed recipient, uint256 amount);
    // Emitted when a sender requests an unlock
    event Unlock(address indexed sender, uint256 startBlock, uint256 endBlock);
    // Emitted when a sender cancels an unlock
    event UnlockCancelled(address indexed sender);
    // Emitted when a sender withdraws its deposit & reserve
    event Withdrawal(address indexed sender, uint256 deposit, uint256 reserve);
}