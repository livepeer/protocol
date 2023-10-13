pragma solidity ^0.8.9;

import "ds-test/test.sol";
import "./base/GovernorBaseTest.sol";
import "contracts/Controller.sol";
import "contracts/bonding/BondingVotes.sol";
import "contracts/bonding/BondingManager.sol";
import "./interfaces/ICheatCodes.sol";

// forge test --match-contract BondingVotesFeeLessVotesFix --fork-url https://arbitrum-mainnet.infura.io/v3/$INFURA_KEY -vvv --fork-block-number 140314540
contract BondingVotesFeeLessVotesFix is GovernorBaseTest {
    bytes public constant arithmeticError = abi.encodeWithSignature("Panic(uint256)", 0x11);

    BondingManager public constant BONDING_MANAGER = BondingManager(0x35Bcf3c30594191d53231E4FF333E8A770453e40);
    IBondingVotes public constant BONDING_VOTES = IBondingVotes(0x0B9C254837E72Ebe9Fe04960C43B69782E68169A);

    bytes32 public constant BONDING_VOTES_TARGET_ID = keccak256("BondingVotesTarget");

    BondingVotes public newBondingVotesTarget;

    address public DELEGATOR = 0xdB18A9353139880d73616e4972a855d66C9B69f0;

    function setUp() public {
        newBondingVotesTarget = new BondingVotes(address(CONTROLLER));
    }

    function doUpgrade() internal {
        (, gitCommitHash) = CONTROLLER.getContractInfo(BONDING_VOTES_TARGET_ID);

        stageAndExecuteOne(
            address(CONTROLLER),
            0,
            abi.encodeWithSelector(
                CONTROLLER.setContractInfo.selector,
                BONDING_VOTES_TARGET_ID,
                address(newBondingVotesTarget),
                gitCommitHash
            )
        );

        // Check that new BondingVotesTarget is registered
        (address infoAddr, bytes20 infoGitCommitHash) = fetchContractInfo(BONDING_VOTES_TARGET_ID);
        assertEq(infoAddr, address(newBondingVotesTarget));
        assertEq(infoGitCommitHash, gitCommitHash);
    }

    function testBeforeUpgrade() public {
        CHEATS.expectRevert(arithmeticError);
        BONDING_VOTES.getVotes(DELEGATOR);
    }

    function testAfterUpgrade() public {
        doUpgrade();

        uint256 votes = BONDING_VOTES.getVotes(DELEGATOR);
        assertTrue(votes > 0);
    }
}
