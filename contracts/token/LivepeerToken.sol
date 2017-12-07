pragma solidity ^0.4.17;

import "zeppelin-solidity/contracts/token/MintableToken.sol";


// Livepeer Token
contract LivepeerToken is MintableToken {
    string public name = "Livepeer Token";
    uint8 public decimals = 18;
    string public symbol = "LPT";
    string public version = "0.1";
}
