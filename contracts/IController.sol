pragma solidity ^0.4.17;

import "zeppelin-solidity/contracts/lifecycle/Pausable.sol";


contract IController is Pausable {
    function setContract(bytes32 _id, address _contract) external returns (bool);
    function updateController(bytes32 _id, address _controller) external returns (bool);
    function getContract(bytes32 _id) public constant returns (address);
}
