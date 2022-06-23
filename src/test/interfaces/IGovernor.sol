pragma solidity ^0.8.9;

interface IGovernor {
    struct Update {
        address[] target;
        uint256[] value;
        bytes[] data;
        uint256 nonce;
    }

    function stage(Update memory _update, uint256 _delay) external;

    function execute(Update memory _update) external payable;

    function cancel(Update memory _update) external;
}
