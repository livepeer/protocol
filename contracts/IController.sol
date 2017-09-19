pragma solidity ^0.4.13;


contract IController {
    function setContract(bytes32 _id, address _contract) external returns (bool);
    function updateContractController(bytes32 _id, address _controller) external returns (bool);
    function isWhitelistedCaller(address _target, address _caller) public constant returns (bool);
}
