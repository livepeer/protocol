pragma solidity ^0.8.9;

import "ds-test/test.sol";
import "contracts/bonding/BondingManager.sol";
import "contracts/libraries/SortedDoublyLL.sol";

interface ICheatCodes {
    function roll(uint256) external;

    function assume(bool) external;

    function prank(address) external;
}

contract TranscoderPoolLensTest is DSTest {
    using SortedDoublyLL for SortedDoublyLL.Data;

    ICheatCodes public constant CHEATS = ICheatCodes(HEVM_ADDRESS);
    BondingManager public constant BONDING_MANAGER = BondingManager(0x35Bcf3c30594191d53231E4FF333E8A770453e40);

    SortedDoublyLL.Data private transcoderPoolMock;
    address[] public ids;
    uint256[] public keys;

    struct TranscoderData {
        address transcoderAddress; // address of the transcoder
        uint256 lastRewardRound; // Last round that the transcoder called reward
        uint256 rewardCut; // % of reward paid to transcoder by a delegator
        uint256 feeShare; // % of fees paid to delegators by transcoder
        uint256 lastActiveStakeUpdateRound; // Round for which the stake was last updated while the transcoder is active
        uint256 activationRound; // Round in which the transcoder became active - 0 if inactive
        uint256 deactivationRound; // Round in which the transcoder will become inactive
    }

    function generateFixture(uint256 _size) private {
        transcoderPoolMock.setMaxSize(_size);
        for (uint256 i = 0; i < _size; i++) {
            ids.push(address(uint160(i + 1)));
            keys.push(i);
            transcoderPoolMock.insert(ids[i], i + 1, address(0), address(0));
        }
    }

    function getAndParseTranscoderData(address _transcoder) private returns (TranscoderData memory) {
        (
            uint256 lastRewardRound,
            uint256 rewardCut,
            uint256 feeShare,
            uint256 lastActiveStakeUpdateRound,
            uint256 activationRound,
            uint256 deactivationRound,
            ,
            ,
            ,

        ) = BONDING_MANAGER.getTranscoder(_transcoder);
        return
            TranscoderData({
                transcoderAddress: _transcoder,
                lastRewardRound: lastRewardRound,
                rewardCut: rewardCut,
                feeShare: feeShare,
                lastActiveStakeUpdateRound: lastActiveStakeUpdateRound,
                activationRound: activationRound,
                deactivationRound: deactivationRound
            });
    }

    function forwardMockLinkedListTraversal() private returns (address[] memory) {
        address[] memory transcoders = new address[](transcoderPoolMock.getSize());
        address nextId = transcoderPoolMock.getFirst();
        uint256 i;
        while (nextId != address(0)) {
            emit log_uint(i);
            transcoders[i++] = nextId;
            nextId = transcoderPoolMock.getNext(nextId);
        }

        return transcoders;
    }

    function forwardBondingManagerTraversal() private returns (address[] memory) {
        address[] memory transcoders = new address[](BONDING_MANAGER.getTranscoderPoolSize());
        address nextId = BONDING_MANAGER.getFirstTranscoderInPool();
        uint256 i;
        while (nextId != address(0)) {
            transcoders[i++] = nextId;
            nextId = BONDING_MANAGER.getNextTranscoderInPool(nextId);
        }

        return transcoders;
    }

    function forwardBondingManagerTraversalWithData() private returns (TranscoderData[] memory) {
        TranscoderData[] memory transcoders = new TranscoderData[](BONDING_MANAGER.getTranscoderPoolSize());
        address nextId = BONDING_MANAGER.getFirstTranscoderInPool();
        uint256 i;
        while (nextId != address(0)) {
            transcoders[i++] = getAndParseTranscoderData(nextId);
            nextId = BONDING_MANAGER.getNextTranscoderInPool(nextId);
        }

        return transcoders;
    }

    function testMockLinkedListTraversal(uint256 _size) public {
        CHEATS.assume(_size < 10000 && _size > transcoderPoolMock.getSize());
        // logs the uint256 _size generated by the fuzzer
        emit log_uint(_size);
        generateFixture(_size);
        address[] memory nodes = forwardMockLinkedListTraversal();
        assertEq(nodes.length, transcoderPoolMock.getSize());
        assertEq(nodes[0], transcoderPoolMock.getFirst());
        assertEq(nodes[nodes.length - 1], transcoderPoolMock.getLast());
    }

    function testBondingManagerTraversal() public {
        address[] memory nodes = forwardBondingManagerTraversal();
        assertEq(nodes.length, BONDING_MANAGER.getTranscoderPoolSize());
        assertEq(nodes[0], BONDING_MANAGER.getFirstTranscoderInPool());
    }

    function testBondingManagerTraversalWithData() public {
        TranscoderData[] memory nodes = forwardBondingManagerTraversalWithData();
        assertEq(nodes.length, BONDING_MANAGER.getTranscoderPoolSize());
        assertEq(nodes[0].transcoderAddress, BONDING_MANAGER.getFirstTranscoderInPool());
        (uint256 lastRewardRound, , , , , , , , , ) = BONDING_MANAGER.getTranscoder(
            nodes[nodes.length - 1].transcoderAddress
        );
        assertEq(nodes[nodes.length - 1].lastRewardRound, lastRewardRound);
    }
}
