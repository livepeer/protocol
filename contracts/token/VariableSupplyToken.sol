pragma solidity ^0.4.17;

import "zeppelin-solidity/contracts/token/MintableToken.sol";


contract VariableSupplyToken is MintableToken {
    event Burn(address indexed burner, uint256 value);

    /*
     * @dev Burns a specific amount of the sender's tokens
     * @param _value The amount of tokens to be burned
     */
    function burn(uint256 _amount) public {
        // Must not burn more than the sender owns
        require(_amount <= balances[msg.sender]);

        address burner = msg.sender;
        balances[burner] = balances[burner].sub(_amount);
        totalSupply = totalSupply.sub(_amount);

        Burn(burner, _amount);
    }
}
