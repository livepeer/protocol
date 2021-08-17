// SPDX-FileCopyrightText: 2021 Livepeer <info@livepeer.org>

// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.4;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "../Manager.sol";

contract MerkleSnapshot is Manager {
    mapping(bytes32 => bytes32) public snapshot;

    constructor(address _controller) public Manager(_controller) {}

    function setSnapshot(bytes32 _id, bytes32 _root) external onlyControllerOwner {
        snapshot[_id] = _root;
    }

    function verify(
        bytes32 _id,
        bytes32[] calldata _proof,
        bytes32 _leaf
    ) external view returns (bool) {
        return MerkleProof.verify(_proof, snapshot[_id], _leaf);
    }
}
