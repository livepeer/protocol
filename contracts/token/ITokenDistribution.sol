pragma solidity ^0.4.25;


contract ITokenDistribution {
    function isOver() public view returns (bool);
    function getEndTime() public view returns (uint256);
}
