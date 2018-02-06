pragma solidity ^0.4.17;

import "./ILivepeerToken.sol";
import "./VariableSupplyToken.sol";


// Livepeer Token
contract LivepeerToken is ILivepeerToken, VariableSupplyToken {
    string public name = "Livepeer Token";
    uint8 public decimals = 18;
    string public symbol = "LPT";
    string public version = "0.1";
}
