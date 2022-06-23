pragma solidity ^0.8.9;

import "ds-test/test.sol";
import "contracts/Controller.sol";
import "../interfaces/ICheatCodes.sol";
import "../interfaces/IGovernor.sol";

contract GovernorBaseTest is DSTest {
    ICheatCodes public constant CHEATS = ICheatCodes(HEVM_ADDRESS);

    IGovernor public constant GOVERNOR = IGovernor(0xD9dEd6f9959176F0A04dcf88a0d2306178A736a6);
    Controller public constant CONTROLLER = Controller(0xD8E8328501E9645d16Cf49539efC04f734606ee4);
    address public constant GOVERNOR_OWNER = 0x04F53A0bb244f015cC97731570BeD26F0229da05;

    bytes20 internal gitCommitHash;

    function stageAndExecuteOne(
        address _target,
        uint256 _value,
        bytes memory _data
    ) internal {
        address[] memory targets = new address[](1);
        uint256[] memory values = new uint256[](1);
        bytes[] memory data = new bytes[](1);
        targets[0] = _target;
        values[0] = _value;
        data[0] = _data;
        IGovernor.Update memory update = IGovernor.Update({ target: targets, value: values, data: data, nonce: 0 });

        // Impersonate Governor owner
        CHEATS.prank(GOVERNOR_OWNER);
        GOVERNOR.stage(update, 0);
        GOVERNOR.execute(update);
    }

    function stageAndExecuteMany(
        address[] memory _target,
        uint256[] memory _value,
        bytes[] memory _data
    ) internal {
        IGovernor.Update memory update = IGovernor.Update({ target: _target, value: _value, data: _data, nonce: 0 });

        // Impersonate Governor owner
        CHEATS.startPrank(GOVERNOR_OWNER);
        GOVERNOR.stage(update, 0);
        GOVERNOR.execute(update);
        CHEATS.stopPrank();
    }

    function fetchContractInfo(bytes32 _targetId) internal view returns (address, bytes20) {
        (address infoAddr, bytes20 infoGitCommitHash) = CONTROLLER.getContractInfo(_targetId);
        return (infoAddr, infoGitCommitHash);
    }
}
