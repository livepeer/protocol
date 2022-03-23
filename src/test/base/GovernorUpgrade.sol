pragma solidity ^0.8.9;

import "ds-test/test.sol";
import "contracts/Controller.sol";
import "contracts/governance/Governor.sol";
import "../interfaces/ICheatCodes.sol";

contract GovernorUpgrade is DSTest {
    ICheatCodes public constant CHEATS = ICheatCodes(HEVM_ADDRESS);

    Governor public constant GOVERNOR = Governor(0xD9dEd6f9959176F0A04dcf88a0d2306178A736a6);
    Controller public constant CONTROLLER = Controller(0xD8E8328501E9645d16Cf49539efC04f734606ee4);
    address public constant GOVERNOR_OWNER = 0x04F53A0bb244f015cC97731570BeD26F0229da05;

    // Governor update
    address[] internal targets;
    uint256[] internal values;
    bytes[] internal data;
    bytes20 internal gitCommitHash;

    function upgrade() internal {
        Governor.Update memory update = Governor.Update({ target: targets, value: values, data: data, nonce: 0 });

        // Impersonate Governor owner
        CHEATS.prank(GOVERNOR_OWNER);
        GOVERNOR.stage(update, 0);
        GOVERNOR.execute(update);
    }

    function fetchContractInfo(bytes32 _targetId) internal view returns (address, bytes20) {
        (address infoAddr, bytes20 infoGitCommitHash) = CONTROLLER.getContractInfo(_targetId);
        return (infoAddr, infoGitCommitHash);
    }
}
