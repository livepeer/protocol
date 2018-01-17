pragma solidity ^0.4.17;


contract RevertProxy {
    bytes data;

    function() public {
        data = msg.data;
    }

    // solium-disable security/no-low-level-calls
    function execute(address _target) external returns (bool) {
        return _target.call(data);
    }
}
