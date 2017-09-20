pragma solidity ^0.4.13;

import "../token/IMinter.sol";


contract MinterMock is IMinter {
    uint256 mintedTokens;

    function setMintedTokens(uint256 _amount) external {
        mintedTokens = _amount;
    }

    function mint(uint256 _activeStake, uint256 _totalActiveStake) external returns (uint256) {
        return mintedTokens;
    }

    function transferTokens(address _to, uint256 _amount) external returns (bool) {
        return true;
    }
}
