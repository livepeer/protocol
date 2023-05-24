pragma solidity ^0.8.9;

import "ds-test/test.sol";
import "forge-std/console.sol";
import "./interfaces/ICheatCodes.sol";
import "contracts/bonding/BondingManager.sol";
import "contracts/bonding/Votes.sol";

contract VotesExperiment is DSTest {
    string constant ARB_MAINNET_RPC_URL = ""; // SET THIS VALUE
    ICheatCodes public constant CHEATS = ICheatCodes(HEVM_ADDRESS);
    BondingManager public constant BONDING_MANAGER = BondingManager(0x35Bcf3c30594191d53231E4FF333E8A770453e40);

    struct QueryForksData {
        uint256 round;
        uint256 block;
        address transcoder;
    }

    function queryForks(QueryForksData memory data) public {
        uint256 forkId1 = CHEATS.createFork(ARB_MAINNET_RPC_URL);
        uint256 forkId2 = CHEATS.createFork(ARB_MAINNET_RPC_URL, data.block);

        // Fork 1 is the present
        // We run getVotes() on a past round
        CHEATS.selectFork(forkId1);

        Votes votes = new Votes(BONDING_MANAGER);
        console.logUint(votes.getVotes(data.transcoder, data.round));

        // Fork 2 is set to the first block of the past round
        // We get the transcoder's stake at that point in time
        CHEATS.selectFork(forkId2);

        console.logUint(BONDING_MANAGER.transcoderTotalStake(data.transcoder));

        // In theory, we should log the same values for the two forks
    }

    function test1() public {
        QueryForksData[] memory dataArr = new QueryForksData[](3);

        // https://arbiscan.io/tx/0xd4fafd7deaac1414fb264b2e33057e645201288156dd4b092ff1327b8d912214
        dataArr[0] = QueryForksData({
            round: 2980,
            block: 93612609 + 1,
            transcoder: 0x11b04d9A305abE978aEADdc67d9d09aAa4996090
        });
        // https://arbiscan.io/tx/0xf78961edc6879099cd9d3afc334487362857f417eb35a8454e15ff6ce57505d5
        dataArr[1] = QueryForksData({
            round: 2979,
            block: 93311243 + 1,
            transcoder: 0x11b04d9A305abE978aEADdc67d9d09aAa4996090
        });
        // https://arbiscan.io/tx/0x79a68a06ef217a1cf4d0feb5dab3113737f875926a2285164e700833950734bd
        dataArr[2] = QueryForksData({
            round: 2978,
            block: 93012718 + 1,
            transcoder: 0x11b04d9A305abE978aEADdc67d9d09aAa4996090
        });

        for (uint256 i = 0; i < dataArr.length; i++) {
            queryForks(dataArr[i]);
        }
    }
}
