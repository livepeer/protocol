pragma solidity ^0.4.17;

import "zeppelin-solidity/contracts/lifecycle/Pausable.sol";


contract IController is Pausable {
    event SetContract(bytes32 id, address contractAddr);

    function setContract(bytes32 _id, address _contract) external;
    function updateController(bytes32 _id, address _controller) external;
    function getContract(bytes32 _id) public view returns (address);
}
