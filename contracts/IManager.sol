// SPDX-FileCopyrightText: 2021 Livepeer <info@livepeer.org>
// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.4;

interface IManager {
    event SetController(address controller);
    event ParameterUpdate(string param);

    function setController(address _controller) external;
}
