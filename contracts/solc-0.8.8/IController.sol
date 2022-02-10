// SPDX-License-Identifier: MIT
// solhint-disable-next-line
pragma solidity 0.8.9;

interface IController {
    function setContractInfo(
        bytes32 _id,
        address _contractAddress,
        bytes20 _gitCommitHash
    ) external;

    function updateController(bytes32 _id, address _controller) external;

    function getContract(bytes32 _id) external view returns (address);

    function owner() external view returns (address);

    function paused() external view returns (bool);
}
