// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

interface IMerkleSnapshot {
    function verify(
        bytes32 _id,
        bytes32[] calldata _proof,
        bytes32 _leaf
    ) external view returns (bool);
}
