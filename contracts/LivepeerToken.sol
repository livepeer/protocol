pragma solidity ^0.4.13;

import "zeppelin-solidity/contracts/token/MintableToken.sol";

// Abstract contract for the ERC20 token standard
// Livepeer Token
contract LivepeerToken is MintableToken {

    string public name = "Livepeer Token";
    uint8 public decimals = 18;
    string public symbol = "LPT";
    string public version = "0.1";

    function LivepeerToken() {}

    /* Don't accept random ETH sent to this contract */
    function () {
        revert();
    }

}
