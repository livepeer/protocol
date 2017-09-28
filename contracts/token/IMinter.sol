pragma solidity ^0.4.13;


contract IMinter {
    function mint(uint256 _activeStake, uint256 _totalActiveStake) external returns (uint256);
    function transferTokens(address _to, uint256 _amount) external returns (bool);
}
