pragma solidity ^0.4.11;


import './ERC20Basic.sol';
import '../ownership/Ownable.sol';
import '../payment/PullPayment.sol';

/**
 * @title TokenOption
 * @dev TokenOption is a token holder contract that will allow 
 * anyone to buy tokens at a certain rate in wei
 */
contract TokenOption is Ownable, PullPayment {
  
  // ERC20 basic token contract being held
  ERC20Basic token;

  // rate in token per wei
  uint rate;

  function TokenOption(ERC20Basic _token, uint _rate) {
    token = _token;
    rate = _rate;
  }

  /**
   * @notice Transfers tokens held by option contract to buyer.
   */
  function buy() {
    uint256 amount = msg.value * rate; // TODO: safemath
    token.transfer(msg.sender, amount);
    asyncSend(owner, msg.value);
  }

}
