// SPDX-License-Identifier: MIT
// solhint-disable-next-line
pragma solidity 0.8.8;

interface IManager {
    event SetController(address controller);
    event ParameterUpdate(string param);

    function setController(address _controller) external;
}
