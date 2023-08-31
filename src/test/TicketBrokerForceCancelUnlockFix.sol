pragma solidity ^0.8.9;

import "ds-test/test.sol";
import "./base/GovernorBaseTest.sol";
import "contracts/pm/TicketBroker.sol";
import "./interfaces/ICheatCodes.sol";

// forge test --match-contract TicketBrokerForceCancelUnlockFix --fork-url https://arbitrum-mainnet.infura.io/v3/<INFURA_KEY> -vvv --fork-block-number 121404685
contract TicketBrokerForceCancelUnlockFix is GovernorBaseTest {
    TicketBroker public constant TICKET_BROKER = TicketBroker(0xa8bB618B1520E284046F3dFc448851A1Ff26e41B);

    bytes32 public constant TICKET_BROKER_TARGET_ID = keccak256("TicketBrokerTarget");

    TicketBroker public newTicketBrokerTarget;

    address public thirdParty;
    address public broadcaster;

    function setUp() public {
        // Setup accounts
        thirdParty = newAddr();
        broadcaster = newAddr();

        uint256 mockBalance = 1000;

        CHEATS.deal(thirdParty, mockBalance);
        CHEATS.deal(broadcaster, mockBalance);

        // Broadcaster initiates an unlock
        CHEATS.startPrank(broadcaster);
        TICKET_BROKER.fundDepositAndReserve{ value: 2 }(1, 1);
        TICKET_BROKER.unlock();
        CHEATS.stopPrank();

        newTicketBrokerTarget = new TicketBroker(address(CONTROLLER));

        (, gitCommitHash) = CONTROLLER.getContractInfo(TICKET_BROKER_TARGET_ID);

        stageAndExecuteOne(
            address(CONTROLLER),
            0,
            abi.encodeWithSelector(
                CONTROLLER.setContractInfo.selector,
                TICKET_BROKER_TARGET_ID,
                address(newTicketBrokerTarget),
                gitCommitHash
            )
        );
    }

    function testUpgrade() public {
        // Check that new TicketBrokerTarget is registered
        (address infoAddr, bytes20 infoGitCommitHash) = fetchContractInfo(TICKET_BROKER_TARGET_ID);
        assertEq(infoAddr, address(newTicketBrokerTarget));
        assertEq(infoGitCommitHash, gitCommitHash);
    }

    // A fundDepositAndReserveFor() call by a third party should not reset an unlock request after the upgrade
    function testThirdPartyFundDepositAndReserveFor() public {
        assertTrue(TICKET_BROKER.isUnlockInProgress(broadcaster));

        CHEATS.prank(thirdParty);
        TICKET_BROKER.fundDepositAndReserveFor(broadcaster, 0, 0);

        assertTrue(TICKET_BROKER.isUnlockInProgress(broadcaster));
    }

    // A fundDepositAndReserveFor() call by the broadcaster should still reset an unlock request after the upgrade
    function testSenderFundDepositAndReserveFor() public {
        assertTrue(TICKET_BROKER.isUnlockInProgress(broadcaster));

        CHEATS.prank(broadcaster);
        TICKET_BROKER.fundDepositAndReserveFor(broadcaster, 0, 0);

        assertTrue(!TICKET_BROKER.isUnlockInProgress(broadcaster));
    }
}
