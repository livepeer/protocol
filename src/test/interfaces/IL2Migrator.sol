pragma solidity ^0.8.9;

interface IL2Migrator {
    function claimStake(
        address,
        uint256,
        uint256,
        bytes32[] calldata,
        address
    ) external;
}
