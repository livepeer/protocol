pragma solidity ^0.8.9;

interface ICheatCodes {
    function roll(uint256) external;

    function prank(address) external;

    function startPrank(address) external;

    function stopPrank() external;

    function expectRevert(bytes calldata) external;

    function expectEmit(
        bool checkTopic1,
        bool checkTopic2,
        bool checkTopic3,
        bool checkData
    ) external;

    function mockCall(
        address,
        bytes calldata,
        bytes calldata
    ) external;

    function addr(uint256) external returns (address);
}
