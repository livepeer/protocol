pragma solidity ^0.4.17;


contract ITokenDistribution {
    function isActive() public view returns (bool);
    function isOver() public view returns (bool);
    function getEndTime() public view returns (uint256);
}
