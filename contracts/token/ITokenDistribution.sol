pragma solidity ^0.4.17;


contract ITokenDistribution {
    function isOver() public view returns (bool);
    function getEndTime() public view returns (uint256);
}
