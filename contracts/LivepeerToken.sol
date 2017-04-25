pragma solidity ^0.4.8;

import '../installed_contracts/zeppelin/contracts/token/MintableToken.sol';
import '../installed_contracts/zeppelin/contracts/ownership/Ownable.sol';
import '../installed_contracts/zeppelin/contracts/SafeMath.sol';

// Abstract contract for the ERC20 token standard
// Livepeer Token
contract LivepeerToken is MintableToken {

    string public name = "Livepeer Token";
    uint8 public decimals = 18;
    string public symbol = "LPT";
    string public version = "0.1";
    uint64 public initialSupply = 10000;

    function LivepeerToken() {
        mint(msg.sender, initialSupply);        
    }

    /* Don't accept random ETH sent to this contract */
    function () {
        throw;
    }

}
