import BigNumber from "bignumber.js";
import RPC from "../utils/rpc";
import { toSmallestUnits } from "../utils/bn_util";
import MerkleTree from "../utils/merkleTree";
import abi from "ethereumjs-abi";
import utils from "ethereumjs-util";

const LivepeerProtocol = artifacts.require("./LivepeerProtocol.sol");
const LivepeerToken = artifacts.require("./LivepeerToken.sol");

// Delegator status
const DELEGATOR_INACTIVE = 0;
const DELEGATOR_PENDING = 1;
const DELEGATOR_BONDED = 2;
const DELEGATOR_UNBONDING = 3;

// Round length
const ROUND_LENGTH = 50;

// Cycles per round
const CYCLES_PER_ROUND = 2;

// Unbonding period
const UNBONDING_PERIOD = 2;

// Block reward cut
const BLOCK_REWARD_CUT = 10;

// Fee share
const FEE_SHARE = 5;

// Price per segment
const PRICE_PER_SEGMENT = 100;

// Job status
const JOB_INACTIVE = 0;
const JOB_ACTIVE = 1;

// Job ending period
const JOB_ENDING_PERIOD = 100;

// Verification period
const VERIFICATION_PERIOD = 100;

contract('LivepeerProtocol', function(accounts) {
    let rpc;
    let snapshotId;

    before(function() {
        rpc = new RPC(web3);
    });

    beforeEach("snapshot checkpoint to revert back to later", async function() {
        snapshotId = await rpc.snapshot();

        // Start at the beginning of a round
        await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);
    });

    afterEach("revert back to snapshot checkpoint", async function() {
        await rpc.revert(snapshotId);
    });

    it("should initialize correctly", async function() {
        const instance = await LivepeerProtocol.deployed();

        const unbondingPeriod = await instance.unbondingPeriod.call();
        assert.equal(unbondingPeriod.toNumber(), UNBONDING_PERIOD, "unbonding period was not 10 blocks");

        const truebitAddress = await instance.truebitAddress.call();
        assert.equal(truebitAddress, "0x647167a598171d06aecf0f5fa1daf3c5cc848df0", "Truebit value was not set");
    });

    describe("transcoder", function() {
        it("should allow becoming a transcoder", async function() {
            const instance = await LivepeerProtocol.new(1, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptAddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptAddress);

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            const transcoder = await instance.transcoders.call(accounts[1]);
            assert.equal(transcoder[0], accounts[1], "becoming a transcoder did not work");

            // Approve token transfer for account 1
            await lpt.approve(instance.address, 2000, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(2000, accounts[1], {from: accounts[1]});

            const isActiveTranscoder = await instance.isActiveTranscoder(accounts[1]);
            assert.isOk(isActiveTranscoder, "active transcoder pool did not update correctly");
        });

        it("should not set pending transcoder information values as current transcoder information values before start of new round", async function() {
            const instance = await LivepeerProtocol.new(1, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            const transcoder = await instance.transcoders.call(accounts[1]);

            const blockRewardCut = transcoder[5];
            assert.equal(blockRewardCut, 0, "transcoder registration did not set current blockRewardCut correctly");

            const feeShare = transcoder[6];
            assert.equal(feeShare, 0, "transcoder registration did not set current feeShare correctly");

            const pricePerSegment = transcoder[7];
            assert.equal(pricePerSegment, 0, "transcoder registration did not set current pricePerSegment correctly");
        });

        it("should fail for blockRewardCut less than 0", async function() {
            const instance = await LivepeerProtocol.new(1, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});

            let threw = false;

            try {
                await instance.transcoder(-1, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});
            } catch (err) {
                threw = true;
            }

            assert.isOk(threw, "transcoder registration did not throw for blockRewardCut less than 0");
        });

        it("should fail for blockRewardCut greater than 100", async function() {
            const instance = await LivepeerProtocol.new(1, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});

            let threw = false;

            try {
                await instance.transcoder(101, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});
            } catch (err) {
                threw = true;
            }

            assert.isOk(threw, "transcoder registration did not throw for blockRewardCut greater than 100");
        });

        it("should fail for feeShare less than 0", async function() {
            const instance = await LivepeerProtocol.new(1, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});

            let threw = false;

            try {
                await instance.transcoder(BLOCK_REWARD_CUT, -1, PRICE_PER_SEGMENT, {from: accounts[1]});
            } catch (err) {
                threw = true;
            }

            assert.isOk(threw, "transcoder registration did not throw for feeShare less than 0");
        });

        it("should fail for feeShare greater than 100", async function() {
            const instance = await LivepeerProtocol.new(1, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});

            let threw = false;

            try {
                await instance.transcoder(BLOCK_REWARD_CUT, 101, PRICE_PER_SEGMENT, {from: accounts[1]});
            } catch (err) {
                threw = true;
            }

            assert.isOk(threw, "transcoder registration did not throw for feeShare greater than 100");
        });
    });


    it("should allow bonding", async function() {
        const instance = await LivepeerProtocol.new(1, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
        const lptAddress = await instance.token.call();
        const lpt = await LivepeerToken.at(lptAddress);

        // Transfer tokens
        await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

        // Register account 1 as transcoder 1
        await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

        // Approve token transfer for account 1
        await lpt.approve(instance.address, 2000, {from: accounts[1]});

        // Account 1 bonds to self as transcoder
        await instance.bond(2000, accounts[1], {from: accounts[1]});

        // Approve token transfer for account 0
        await lpt.approve(instance.address, 2000, {from: accounts[0]});
        const allowance = await lpt.allowance.call(accounts[0], instance.address);
        assert.equal(allowance, 2000, "token allowance not properly set");

        // Account 0 bonds to transcoder 1
        await instance.bond(1000, accounts[1], {from: accounts[0]});
        const delegator = await instance.delegators.call(accounts[0]);
        assert.equal(delegator[1].toNumber(), 1000, "bond with staked amount did not work");
        assert.equal(delegator[2], accounts[1], "bond to transcoder did not work");

        let delegatorStatus = await instance.delegatorStatus.call(accounts[0]);
        assert.equal(delegatorStatus, DELEGATOR_PENDING, "delegator did not transition to bonded");

        // Fast forward 2 rounds
        await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH, 2);

        delegatorStatus = await instance.delegatorStatus.call(accounts[0]);
        assert.equal(delegatorStatus, DELEGATOR_BONDED, "delegator did not transition to bonded");
    });

    it("should allow updating and moving bonded stake", async function() {
        const instance = await LivepeerProtocol.new(1, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
        const lptAddress = await instance.token.call();
        const lpt = await LivepeerToken.at(lptAddress);

        // Transfer tokens
        await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

        // Register account 1 as transcoder 1
        await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

        // Approve token transfer for account 1
        await lpt.approve(instance.address, 2000, {from: accounts[1]});

        // Account 1 bonds to self as transcoder
        await instance.bond(2000, accounts[1], {from: accounts[1]});

        // Approve token transfer for account 0
        await lpt.approve(instance.address, 2000, {from: accounts[0]});

        // Account 0 bonds to transcoder 1
        await instance.bond(1000, accounts[1], {from: accounts[0]});

        // Fast forward 1 round
        await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

        // Initialize round
        await instance.initializeRound();

        // Fast forward 1 round
        await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

        // Initialize round
        await instance.initializeRound();

        // Transfer tokens
        await lpt.transfer(accounts[2], toSmallestUnits(1), {from: accounts[0]});

        // Register account 2 as transcoder 2
        await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[2]});

        // Approve token transfer for account 2
        await lpt.approve(instance.address, 500, {from: accounts[2]});

        // Account 2 bonds to self as transcoder
        await instance.bond(500, accounts[2], {from: accounts[2]});

        let isCandidateTranscoder = await instance.isCandidateTranscoder(accounts[2]);
        assert.isOk(isCandidateTranscoder, "candidate transcoder pool did not update correctly after transcoder registration");

        // Account 0 increases bond to transcoder 1
        await instance.bond(1000, accounts[1], {from: accounts[0]});
        let delegator = await instance.delegators.call(accounts[0]);
        assert.equal(delegator[1].toNumber(), 1000 + 1000, "updating bonded stake did not work");

        // Account 0 moves bond to transcoder 2
        await instance.bond(0, accounts[2], {from: accounts[0]});
        delegator = await instance.delegators.call(accounts[0]);
        assert.equal(delegator[2], accounts[2], "moving bonded stake did not work");

        let isActiveTranscoder = await instance.isActiveTranscoder(accounts[2]);
        assert.isOk(isActiveTranscoder, "active transcoder pool did not update correctly after moving bond");

        isActiveTranscoder = await instance.isActiveTranscoder(accounts[1]);
        assert.isNotOk(isActiveTranscoder, "active transcoder pool did not remove transcoder correctly after moving bond");

        isCandidateTranscoder = await instance.isCandidateTranscoder(accounts[1]);
        assert.isOk(isCandidateTranscoder, "candidate transcoder pool did not update correctly after moving bond");
    });

    it("should allow unbonding and withdrawal", async function() {
        const instance = await LivepeerProtocol.new(1, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
        const lptAddress = await instance.token.call();
        const lpt = await LivepeerToken.at(lptAddress);

        // Transfer tokens
        await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

        // Register account 1 as transcoder 1
        await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

        // Approve token transfer for account 1
        await lpt.approve(instance.address, 1500, {from: accounts[1]});

        // Account 1 bonds to self as transcoder
        await instance.bond(1500, accounts[1], {from: accounts[1]});

        // Approve token transfer
        await lpt.approve(instance.address, 1000, {from: accounts[0]});

        // Account 0 bonds to transcoder 1
        await instance.bond(1000, accounts[1], {from: accounts[0]});

        // Transfer tokens
        await lpt.transfer(accounts[2], toSmallestUnits(1), {from: accounts[0]});

        // Register account 2 as transcoder 2
        await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[2]});

        // Approve token transfer for account 2
        await lpt.approve(instance.address, 2000, {from: accounts[2]});

        // Account 2 bonds to self as transcoder
        await instance.bond(2000, accounts[2], {from: accounts[2]});

        let isActiveTranscoder = await instance.isActiveTranscoder(accounts[1]);
        assert.isOk(isActiveTranscoder, "transcoder 1 has the most stake and is not active");

        let isCandidateTranscoder = await instance.isCandidateTranscoder(accounts[2]);
        assert.isOk(isCandidateTranscoder, "transcoder 2 has less stake than transcoder 2 and is not a candidate");

        // Fast forward 1 round
        await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

        // Initialize round
        await instance.initializeRound();

        // Fast forward 1 round
        await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

        // Initialize round
        await instance.initializeRound();

        // Account 0 unbonds
        await instance.unbond({from: accounts[0]});

        const delegatorStatus = await instance.delegatorStatus.call(accounts[0]);
        assert.equal(delegatorStatus, DELEGATOR_UNBONDING, "delegator did not transition to unbonding");

        // Fast forward 1 round
        await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

        // Initialize round
        await instance.initializeRound();

        // Fast forward 1 round
        await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

        // Initialize round
        await instance.initializeRound();

        // Account 0 withdraws
        await instance.withdraw({from: accounts[0]});
        const balance = await lpt.balanceOf.call(accounts[0]);
        assert.equal(balance.toNumber(), toSmallestUnits(1), "withdrawing bonded tokens did not work");

        isActiveTranscoder = await instance.isActiveTranscoder(accounts[2]);
        assert.isOk(isActiveTranscoder, "unbonding did not cause transcoder to become a active");

        isCandidateTranscoder = await instance.isCandidateTranscoder(accounts[1]);
        assert.isOk(isCandidateTranscoder, "unbonding did not cause transcoder to become a candidate");
    });

    it("should allow unbonding and reject premature withdrawals", async function() {
        const instance = await LivepeerProtocol.new(1, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
        const lptaddress = await instance.token.call();
        const lpt = await LivepeerToken.at(lptaddress);

        // transfer tokens
        await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

        // register account 1 as transcoder 1
        await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

        // approve token transfer for account 1
        await lpt.approve(instance.address, 2000, {from: accounts[1]});

        // account 1 bonds to self as transcoder
        await instance.bond(2000, accounts[1], {from: accounts[1]});

        // approve token transfer
        await lpt.approve(instance.address, 2000, {from: accounts[0]});

        // account 0 bonds to transcoder 1
        await instance.bond(1000, accounts[1], {from: accounts[0]});

        // Fast forward 1 round
        await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

        // Initialize round
        await instance.initializeRound();

        // Fast forward 1 round
        await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

        // Initialize round
        await instance.initializeRound();

        // Account 0 unbonds
        await instance.unbond({from: accounts[0]});

        // Withdraw
        let threw = false;

        try {
            await instance.withdraw({from: accounts[0]});
        } catch (err) {
            threw = true;
        }

        assert.ok(threw, "premature withdraw did not throw");
    });

    describe("resignAsTranscoder", function() {
        it("should throw if called by inactive transcoder", async function() {
            const instance = await LivepeerProtocol.new(1, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});

            let threw = false;

            try {
                await instance.resignAsTranscoder({from: accounts[1]});
            } catch (err) {
                threw = true;
            }

            assert.isOk(threw, "resignAsTranscoder succeeded when it should have thrown");
        });

        it("should update transcoder fields and remove transcoder from pools", async function() {
            const instance = await LivepeerProtocol.new(1, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            // transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            // approve token transfer for account 1
            await lpt.approve(instance.address, 2000, {from: accounts[1]});

            // account 1 bonds to self as transcoder
            await instance.bond(2000, accounts[1], {from: accounts[1]});

            // approve token transfer
            await lpt.approve(instance.address, 2000, {from: accounts[0]});

            // account 0 bonds to transcoder 1
            await instance.bond(1000, accounts[1], {from: accounts[0]});

            // Transcoder 1 resigns
            await instance.resignAsTranscoder({from: accounts[1]});

            const transcoder = await instance.transcoders.call(accounts[1]);
            assert.equal(transcoder[1], 0, "resignAsTranscoder did not zero out transcoder bonded amount");
            const delegatorWithdrawRound = Math.floor(web3.eth.blockNumber / ROUND_LENGTH) + UNBONDING_PERIOD;
            assert.equal(transcoder[2], delegatorWithdrawRound, "resignAsTranscoder did not set delegatorWithdrawRound");
            assert.equal(transcoder[3], false, "resignAsTranscoder did not set transcoder as inactive");

            const delegatorStatus = await instance.delegatorStatus(accounts[0]);
            assert.equal(delegatorStatus, DELEGATOR_UNBONDING, "resignAsTranscoder did not cause delegators to unbond");

            const isActiveTranscoder = await instance.isActiveTranscoder(accounts[1]);
            assert.isNotOk(isActiveTranscoder, "resignAsTranscoder did not remove transcoder from active pool");
        });
    });

    describe("initializeRound", function() {
        it("should set the current round active transcoders", async function() {
            const instance = await LivepeerProtocol.new(1, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, 2000, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(2000, accounts[1], {from: accounts[1]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            let elected = await instance.electCurrentActiveTranscoder(200);
            assert.equal(elected, accounts[1], "initialize round did not set current round active transcoders");

            // Transfer tokens
            await lpt.transfer(accounts[2], toSmallestUnits(1), {from: accounts[0]});

            // Register account 2 as transcoder 2
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[2]});

            // Approve token transfer for account 2
            await lpt.approve(instance.address, 3000, {from: accounts[2]});

            // Account 2 bonds to self as transcoder
            await instance.bond(3000, accounts[2], {from: accounts[2]});

            // Fast forward 1 rounds
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            elected = await instance.electCurrentActiveTranscoder(200);
            assert.equal(elected, accounts[2], "initialize round did not set current round active transcoders after stake change");
        });

        it("should not change current transcoder set if initializeRound is not called", async function() {
            const instance = await LivepeerProtocol.new(1, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, 2000, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(2000, accounts[1], {from: accounts[1]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            // Transfer tokens
            await lpt.transfer(accounts[2], toSmallestUnits(1), {from: accounts[0]});

            // Register account 2 as transcoder 2
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[2]});

            // Approve token transfer for account 2
            await lpt.approve(instance.address, 3000, {from: accounts[2]});

            // Account 2 bonds to self as transcoder
            await instance.bond(3000, accounts[2], {from: accounts[2]});

            const elected = await instance.electCurrentActiveTranscoder(200);
            assert.equal(elected, accounts[1], "current transcoder set changed without calling initializeRound");
        });

        it("should fail if current round is already initialized", async function() {
            const instance = await LivepeerProtocol.new(1, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, 2000, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(2000, accounts[1], {from: accounts[1]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            // Transfer tokens
            await lpt.transfer(accounts[2], toSmallestUnits(1), {from: accounts[0]});

            // Register account 2 as transcoder 2
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[2]});

            // Approve token transfer for account 2
            await lpt.approve(instance.address, 3000, {from: accounts[2]});

            // Account 2 bonds to self as transcoder
            await instance.bond(3000, accounts[2], {from: accounts[2]});

            await instance.initializeRound();

            const elected = await instance.electCurrentActiveTranscoder(200);
            assert.equal(elected, accounts[1], "initialize round did not return early when it was already called for the current round");
        });

        it("should set the pending transcoder information as the actual transcoder information values", async function() {
            const instance = await LivepeerProtocol.new(1, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, 2000, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(2000, accounts[1], {from: accounts[1]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            const transcoder = await instance.transcoders.call(accounts[1]);

            const blockRewardCut = transcoder[5];
            assert.equal(blockRewardCut, BLOCK_REWARD_CUT, "initialize round did not set pending blockRewardCut as current blockRewardCut");

            const feeShare = transcoder[6];
            assert.equal(feeShare, FEE_SHARE, "initialize round did not set pending feeShare as current feeShare");

            const pricePerSegment = transcoder[7];
            assert.equal(pricePerSegment, PRICE_PER_SEGMENT, "initialize round did not set pending pricePerSegment as current pricePerSegment");
        });
    });

    describe("reward", function() {
        it("should calculate token distribution when it is an active transcoder's turn", async function() {
            const instance = await LivepeerProtocol.new(2, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            const a1Stake = 2000;
            const a2Stake = 3000;
            const a3Stake = 2000;

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, a1Stake, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(a1Stake, accounts[1], {from: accounts[1]});

            // Transfer tokens
            await lpt.transfer(accounts[2], toSmallestUnits(1), {from: accounts[0]});

            // Approve token transfer for account 2
            await lpt.approve(instance.address, a2Stake, {from: accounts[2]});

            // Account 2 bonds to transcoder 1
            await instance.bond(a2Stake, accounts[1], {from: accounts[2]});

            // Transfer tokens
            await lpt.transfer(accounts[3], toSmallestUnits(1), {from: accounts[0]});

            // Approve token transfer for account 3
            await lpt.approve(instance.address, a3Stake, {from: accounts[3]});

            // Account 3 bonds to transcoder 1
            await instance.bond(a3Stake, accounts[1], {from: accounts[3]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            const initialTokenSupply = await lpt.totalSupply.call();

            const initialTotalTranscoderStake = await instance.transcoderTotalStake(accounts[1]);

            let transcoder = await instance.transcoders.call(accounts[1]);
            const initialTranscoderStake = transcoder[1];

            // Transcoder 1 calls reward
            await instance.reward({from: accounts[1]});

            const mintedTokensPerReward = await instance.mintedTokensPerReward();

            const updatedTotalTranscoderStake = await instance.transcoderTotalStake(accounts[1]);

            assert.equal(updatedTotalTranscoderStake.minus(initialTotalTranscoderStake),
                         mintedTokensPerReward.toNumber(),
                         "reward did not update total bonded transcoder stake correctly");

            transcoder = await instance.transcoders.call(accounts[1]);
            const updatedTranscoderStake = transcoder[1];

            assert.equal(updatedTranscoderStake.minus(initialTranscoderStake),
                         mintedTokensPerReward.times(.1).floor().toNumber(),
                         "reward did not update transcoder stake correctly");

            const updatedTokenSupply = await lpt.totalSupply.call();
            assert.equal(updatedTokenSupply.minus(initialTokenSupply).toNumber(), mintedTokensPerReward, "reward did not mint the correct number of tokens");

            let delegator1 = await instance.delegators.call(accounts[2]);
            const initialDelegator1Stake = delegator1[1];

            // Account 2 unbonds and updates stakes with rewards
            await instance.unbond({from: accounts[2]});

            delegator1 = await instance.delegators.call(accounts[2]);
            const updatedDelegator1Stake = delegator1[1];

            assert.equal(updatedDelegator1Stake.minus(initialDelegator1Stake),
                         mintedTokensPerReward.times(a2Stake).dividedBy(a1Stake + a2Stake + a3Stake).times(.9).floor().toNumber(),
                         "delegator 1 unbond did not update delegator 1 stake with rewards correctly");

            let delegator2 = await instance.delegators.call(accounts[3]);
            const initialDelegator2Stake = delegator2[1];

            // Account 3 unbonds and updates stakes with rewards
            await instance.unbond({from: accounts[3]});

            delegator2 = await instance.delegators.call(accounts[3]);
            const updatedDelegator2Stake = delegator2[1];

            assert.equal(updatedDelegator2Stake.minus(initialDelegator2Stake),
                         mintedTokensPerReward.times(a3Stake).dividedBy(a1Stake + a2Stake + a3Stake).times(.9).floor().toNumber(),
                         "delegator 2 unbond did not update delegator 2 stake with rewards correctly");
        });

        it("should fail if an active transcoder already called reward during the current cycle for the round", async function() {
            const instance = await LivepeerProtocol.new(2, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, 2000, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(2000, accounts[1], {from: accounts[1]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            await instance.reward({from: accounts[1]});

            let threw = false;

            try {
                await instance.reward({from: accounts[1]});
            } catch (err) {
                threw = true;
            }

            assert.isOk(threw, "reward did not throw when called more than once in a cycle by a transcoder");
        });

        it("should fail if it is not an active transcoder's turn", async function(){
            const instance = await LivepeerProtocol.new(2, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, 2000, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(2000, accounts[1], {from: accounts[1]});

            // Transfer tokens
            await lpt.transfer(accounts[2], toSmallestUnits(1), {from: accounts[0]});

            // Register account 2 as transcoder 2
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[2]});

            // Approve token transfer for account 2
            await lpt.approve(instance.address, 3000, {from: accounts[2]});

            // Account 2 bonds to self as transcoder
            await instance.bond(3000, accounts[2], {from: accounts[2]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            let threw = false;

            try {
                await instance.reward({from: accounts[2]});
            } catch (err) {
                threw = true;
            }

            assert.isOk(threw, "reward did not throw when called by a transcoder when it is not its turn");
        });

        it("should fail if current round is not initialized", async function() {
            const instance = await LivepeerProtocol.new(2, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            const a1Stake = 2000;
            const a2Stake = 3000;

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, a1Stake, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(a1Stake, accounts[1], {from: accounts[1]});

            // Transfer tokens
            await lpt.transfer(accounts[2], toSmallestUnits(1), {from: accounts[0]});

            // Approve token transfer for account 2
            await lpt.approve(instance.address, a2Stake, {from: accounts[2]});

            // Account 2 bonds to transcoder 1
            await instance.bond(a2Stake, accounts[1], {from: accounts[2]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            let threw = false;

            try {
                await instance.reward({from: accounts[2]});
            } catch (err) {
                threw = true;
            }


            assert.isOk(threw, "reward did not throw when current round was not initialized");
        });
    });

    describe("delegatorStake", function() {
        it("should return correct delegator stake updated with rewards since last state transition", async function() {
            const instance = await LivepeerProtocol.new(2, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            const a1Stake = 2000;
            const a2Stake = 3000;

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, a1Stake, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(a1Stake, accounts[1], {from: accounts[1]});

            // Transfer tokens
            await lpt.transfer(accounts[2], toSmallestUnits(1), {from: accounts[0]});

            // Approve token transfer for account 2
            await lpt.approve(instance.address, a2Stake, {from: accounts[2]});

            // Account 2 bonds to transcoder 1
            await instance.bond(a2Stake, accounts[1], {from: accounts[2]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            // Transcoder 1 calls reward
            await instance.reward({from: accounts[1]});

            const mintedTokensPerReward = await instance.mintedTokensPerReward();

            const delegatorStake = await instance.delegatorStake(accounts[2]);
            assert.equal(delegatorStake,
                         mintedTokensPerReward.times(a2Stake).dividedBy(a1Stake + a2Stake).times(.9).floor().plus(a2Stake).toNumber(),
                         "did not return delegator stake updated with rewards since last state transition");
        });

        it("should return correct delegator if there are no reward updates", async function() {
            const instance = await LivepeerProtocol.new(2, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            const a1Stake = 2000;
            const a2Stake = 3000;

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, a1Stake, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(a1Stake, accounts[1], {from: accounts[1]});

            // Transfer tokens
            await lpt.transfer(accounts[2], toSmallestUnits(1), {from: accounts[0]});

            // Approve token transfer for account 2
            await lpt.approve(instance.address, a2Stake, {from: accounts[2]});

            // Account 2 bonds to transcoder 1
            await instance.bond(a2Stake, accounts[1], {from: accounts[2]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            const delegatorStake = await instance.delegatorStake(accounts[2]);
            assert.equal(delegatorStake, a2Stake, "did not return correct delegator stake if there were no reward updates");
        });
    });

    describe("job", function() {
        it("should create a new job", async function() {
            const instance = await LivepeerProtocol.new(2, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            const a1Stake = 2000;

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, a1Stake, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(a1Stake, accounts[1], {from: accounts[1]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            // Account 2 creates a transcoder job
            await instance.job(1, "0x1", 200, {from: accounts[2]});

            const job = await instance.getJob(0);
            assert.equal(job[0], 0, "job did not set the job id correctly");
            assert.equal(job[1], "0x1000000000000000000000000000000000000000000000000000000000000000", "job did not set the transcoding options correctly");
            assert.equal(job[2], 200, "job did not set the max price per segment correctly");
            assert.equal(job[3], accounts[2], "job did not set the broadcaster address correctly");
            assert.equal(job[4], accounts[1], "job did not set the transcoder address correctly");
            assert.equal(job[5], 0, "job did not set end block correctly");
        });

        it("should fail if there are no available transcoders charging an acceptable price per segment", async function() {
            const instance = await LivepeerProtocol.new(2, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            const a1Stake = 2000;

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, a1Stake, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(a1Stake, accounts[1], {from: accounts[1]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            let threw = false;

            try {
                // Account 2 creates a transcoder job
                await instance.job(1, "0x1", 10, {from: accounts[2]});
            } catch (err) {
                threw = true;
            }

            assert.isOk(threw, "job did not throw when there are no available transcoders charging an acceptable price per segment");
        });

        it("should fail if there are no available transcoders", async function() {
            const instance = await LivepeerProtocol.new(2, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            let threw = false;

            try {
                // Account 2 creates a transcoder job
                await instance.job(1, "0x1", 10, {from: accounts[2]});
            } catch (err) {
                threw = true;
            }

            assert.isOk(threw, "job did not throw when there are no available transcoders");
        });
    });

    describe("endJob", function() {
        it("should set the end block for a job when called by the job's broadcaster", async function() {
            const instance = await LivepeerProtocol.new(2, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            const a1Stake = 2000;

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, a1Stake, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(a1Stake, accounts[1], {from: accounts[1]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            // Account 2 creates a job
            await instance.job(1, "0x1", 200, {from: accounts[2]});

            // Account 2 ends the job
            await instance.endJob(0, {from: accounts[2]});

            const callEndJobBlock = web3.eth.blockNumber;

            const job = await instance.getJob(0);
            assert.equal(job[5], callEndJobBlock + JOB_ENDING_PERIOD, "endJob did not set the end block for the job correctly");

            // Fast forward through job ending period
            await rpc.wait(20, JOB_ENDING_PERIOD);

            const jobStatus = await instance.jobStatus(0);
            assert.equal(jobStatus, JOB_INACTIVE, "job did not become inactive when the current block is greater than or equal to the job's end block");
        });

        it("should set the end block for a job when called by the job's transcoder", async function() {
            const instance = await LivepeerProtocol.new(2, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            const a1Stake = 2000;

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, a1Stake, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(a1Stake, accounts[1], {from: accounts[1]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            // Account 2 creates a job
            await instance.job(1, "0x1", 200, {from: accounts[2]});

            // Account 2 ends the job
            await instance.endJob(0, {from: accounts[1]});

            const callEndJobBlock = web3.eth.blockNumber;

            const job = await instance.getJob(0);
            assert.equal(job[5], callEndJobBlock + JOB_ENDING_PERIOD, "endJob did not set the end block for the job correctly");

            // Fast forward through job ending period
            await rpc.wait(20, JOB_ENDING_PERIOD);

            const jobStatus = await instance.jobStatus(0);
            assert.equal(jobStatus, JOB_INACTIVE, "job did not become inactive when the current block is greater than or equal to the job's end block");
        });

        it("should fail if called by an address that is not a broadcaster or transcoder", async function() {
            const instance = await LivepeerProtocol.new(2, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            const a1Stake = 2000;

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, a1Stake, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(a1Stake, accounts[1], {from: accounts[1]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            // Account 2 creates a job
            await instance.job(1, "0x1", 200, {from: accounts[2]});

            let threw = false;

            try {
                // Account 3 ends the job
                await instance.endJob(0, {from: accounts[3]});
            } catch (err) {
                threw = true;
            }

            assert.isOk(threw, "endJob did not throw when called by an address that is not a broadcaster or transcoder");
        });

        it("should fail if the job already has an end block", async function() {
            const instance = await LivepeerProtocol.new(2, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            const a1Stake = 2000;

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, a1Stake, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(a1Stake, accounts[1], {from: accounts[1]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            // Account 2 creates a job
            await instance.job(1, "0x1", 200, {from: accounts[2]});

            // Account 2 ends the job
            await instance.endJob(0, {from: accounts[2]});

            let threw = false;

            try {
                await instance.endJob(0, {from: accounts[2]});
            } catch (err) {
                threw = true;
            }

            assert.isOk(threw, "endJob did not throw when called for a job that already has an end block");
        });
    });

    describe("claimWork", function() {
        it("should submit transcode claims for a range of segments", async function() {
            const instance = await LivepeerProtocol.new(2, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            const a1Stake = 2000;

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, a1Stake, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(a1Stake, accounts[1], {from: accounts[1]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            // Account 2 creates a transcoder job
            await instance.job(1, "0x1", 200, {from: accounts[2]});

            // Account 1 claims work
            // Use fake Merkle root
            await instance.claimWork(0, 0, 10, "0x1", {from: accounts[1]});

            const claimWorkBlock = web3.eth.blockNumber;

            const transcodeClaimsDetails = await instance.getJobTranscodeClaimsDetails(0);
            assert.equal(transcodeClaimsDetails[0], claimWorkBlock, "claim work did not set the last claimed work block correctly");
            assert.equal(transcodeClaimsDetails[1], claimWorkBlock + VERIFICATION_PERIOD, "claim work did not set the end verification block correctly");
            assert.equal(transcodeClaimsDetails[2], 0, "claim work did not set the start segment of the last segment range claimed correctly");
            assert.equal(transcodeClaimsDetails[3], 10, "claim work did not set the end segment of the last segment range claimed correctly");
            assert.equal(transcodeClaimsDetails[4], "0x1000000000000000000000000000000000000000000000000000000000000000", "claim work did not set the last transcode claim root correctly");
        });

        it("should fail if the job is inactive", async function() {
            const instance = await LivepeerProtocol.new(2, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            const a1Stake = 2000;

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, a1Stake, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(a1Stake, accounts[1], {from: accounts[1]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            // Account 2 creates a job
            await instance.job(1, "0x1", 200, {from: accounts[2]});

            // Account 2 ends the job
            await instance.endJob(0, {from: accounts[1]});

            // Fast forward through job ending period
            await rpc.wait(20, JOB_ENDING_PERIOD);

            let threw = false;

            try {
                await instance.claimWork(0, 0, 10, "0x1", {from: accounts[1]});
            } catch (err) {
                threw = true;
            }

            assert.isOk(threw, "claim work did not throw when called for an inactive job");
        });

        it("should fail if the sender is not the assigned transcoder for the job", async function() {
            const instance = await LivepeerProtocol.new(2, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            const a1Stake = 2000;

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, a1Stake, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(a1Stake, accounts[1], {from: accounts[1]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            // Account 2 creates a job
            await instance.job(1, "0x1", 200, {from: accounts[2]});

            let threw = false;

            try {
                // Account 3 claims work
                await instance.claimWork(0, 0, 10, "0x1", {from: accounts[3]});
            } catch (err) {
                threw = true;
            }

            assert.isOk(threw, "claim work did not throw when called by a sender that is not the assigned transcoder for the job");
        });

        it("shoud fail if the previous verification period is not over", async function() {
            const instance = await LivepeerProtocol.new(2, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            const a1Stake = 2000;

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, a1Stake, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(a1Stake, accounts[1], {from: accounts[1]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            // Account 2 creates a job
            await instance.job(1, "0x1", 200, {from: accounts[2]});

            // Account 2 claims work
            await instance.claimWork(0, 0, 10, "0x1", {from: accounts[1]});

            let threw = false;

            try {
                // Account 2 claims work again
                await instance.claimWork(0, 11, 20, "0x2", {from: accounts[1]});
            } catch (err) {
                threw = true;
            }

            assert.isOk(threw, "claim work did not throw when the previous verification is not over");
        });
    });

    describe("verify", function() {
        it("should verify a transcode claim", async function() {
            const instance = await LivepeerProtocol.new(2, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            const a1Stake = 2000;

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, a1Stake, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(a1Stake, accounts[1], {from: accounts[1]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            const streamId = "1";

            // Account 2 creates a transcoder job
            await instance.job(streamId, "0x1", 200, {from: accounts[2]});

            // Segment data hashes
            const d0 = Buffer.from("80084bf2fba02475726feb2cab2d8215eab14bc6bdd8bfb2c8151257032ecd8b", "hex");
            const d1 = Buffer.from("b039179a8a4ce2c252aa6f2f25798251c19b75fc1508d9d511a191e0487d64a7", "hex");
            const d2 = Buffer.from("263ab762270d3b73d3e2cddf9acc893bb6bd41110347e5d5e4bd1d3c128ea90a", "hex");
            const d3 = Buffer.from("4ce8765e720c576f6f5a34ca380b3de5f0912e6e3cc5355542c363891e54594b", "hex");

            // Segment hashes (streamId, segmentSequenceNumber, dataHash)
            const s0 = abi.soliditySHA3(["string", "uint256", "bytes"], [streamId, 0, d0]);
            const s1 = abi.soliditySHA3(["string", "uint256", "bytes"], [streamId, 1, d1]);
            const s2 = abi.soliditySHA3(["string", "uint256", "bytes"], [streamId, 2, d2]);
            const s3 = abi.soliditySHA3(["string", "uint256", "bytes"], [streamId, 3, d3]);

            // Broadcaster signatures over segments
            const bSig0 = utils.toBuffer(await web3.eth.sign(accounts[2], utils.bufferToHex(s0)));
            const bSig1 = utils.toBuffer(await web3.eth.sign(accounts[2], utils.bufferToHex(s1)));
            const bSig2 = utils.toBuffer(await web3.eth.sign(accounts[2], utils.bufferToHex(s2)));
            const bSig3 = utils.toBuffer(await web3.eth.sign(accounts[2], utils.bufferToHex(s3)));

            // Transcoded data hashes
            const tD0 = Buffer.from("42538602949f370aa331d2c07a1ee7ff26caac9cc676288f94b82eb2188b8465", "hex");
            const tD1 = Buffer.from("a0b37b8bfae8e71330bd8e278e4a45ca916d00475dd8b85e9352533454c9fec8", "hex");
            const tD2 = Buffer.from("9f2898da52dedaca29f05bcac0c8e43e4b9f7cb5707c14cc3f35a567232cec7c", "hex");
            const tD3 = Buffer.from("5a082c81a7e4d5833ee20bd67d2f4d736f679da33e4bebd3838217cb27bec1d3", "hex");

            // Transcode claims
            const tClaim0 = abi.soliditySHA3(["string", "uint256", "bytes", "bytes", "bytes"], [streamId, 0, d0, tD0, bSig0]);
            const tClaim1 = abi.soliditySHA3(["string", "uint256", "bytes", "bytes", "bytes"], [streamId, 1, d1, tD1, bSig1]);
            const tClaim2 = abi.soliditySHA3(["string", "uint256", "bytes", "bytes", "bytes"], [streamId, 2, d2, tD2, bSig2]);
            const tClaim3 = abi.soliditySHA3(["string", "uint256", "bytes", "bytes", "bytes"], [streamId, 3, d3, tD3, bSig3]);

            // Generate Merkle root
            const merkleTree = new MerkleTree([tClaim0, tClaim1, tClaim2, tClaim3]);
            const root = merkleTree.getHexRoot();

            // Account 1 claims work
            await instance.claimWork(0, 0, 3, root, {from: accounts[1]});

            // Get Merkle proof
            const proof = merkleTree.getHexProof(tClaim0);

            let threw = false;

            try {
                // Account 1 calls verify
                await instance.verify(0, 0, utils.bufferToHex(d0), utils.bufferToHex(tD0), utils.bufferToHex(bSig0), proof, {from: accounts[1]});
            } catch (err) {
                threw = true;
            }

            assert.isNotOk(threw, "verify threw when the transcode claim verification was successful");
        });

        it("should fail if the job is inactive", async function() {
            const instance = await LivepeerProtocol.new(2, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            const a1Stake = 2000;

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, a1Stake, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(a1Stake, accounts[1], {from: accounts[1]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            // Account 2 creates a job
            await instance.job(1, "0x1", 200, {from: accounts[2]});

            // Account 1 claims work
            await instance.claimWork(0, 0, 3, "0x1", {from: accounts[1]});

            // Account 2 ends the job
            await instance.endJob(0, {from: accounts[2]});

            // Fast forward through job ending period
            await rpc.wait(20, JOB_ENDING_PERIOD);

            let threw = false;

            try {
                // Account 1 calls verify
                // Fake param data
                await instance.verify(0, 2, "0x1", "0x2", "0x3", "0x4", {from: accounts[1]});
            } catch (err) {
                threw = true;
            }

            assert.isOk(threw, "verify did not throw for an inactive job");
        });

        it("should fail if the sender is not the assigned transcoder for the job", async function() {
            const instance = await LivepeerProtocol.new(2, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            const a1Stake = 2000;

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, a1Stake, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(a1Stake, accounts[1], {from: accounts[1]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            // Account 2 creates a job
            await instance.job(1, "0x1", 200, {from: accounts[2]});

            // Account 1 claims work
            await instance.claimWork(0, 0, 3, "0x1", {from: accounts[1]});

            let threw = false;

            try {
                // Account 3 calls verify
                // Fake param data
                await instance.verify(0, 2, "0x1", "0x2", "0x3", "0x4", {from: accounts[3]});
            } catch (err) {
                threw = true;
            }

            assert.isOk(threw, "verify did not throw when sender is not the assigned transcoder for the job");
        });

        it("should fail if the segment was not signed by the broadcaster for the job", async function() {
            const instance = await LivepeerProtocol.new(2, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            const a1Stake = 2000;

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, a1Stake, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(a1Stake, accounts[1], {from: accounts[1]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            const streamId = "1";

            // Account 2 creates a transcoder job
            await instance.job(streamId, "0x1", 200, {from: accounts[2]});

            // Segment data hashes
            const d0 = Buffer.from("80084bf2fba02475726feb2cab2d8215eab14bc6bdd8bfb2c8151257032ecd8b", "hex");
            const d1 = Buffer.from("b039179a8a4ce2c252aa6f2f25798251c19b75fc1508d9d511a191e0487d64a7", "hex");
            const d2 = Buffer.from("263ab762270d3b73d3e2cddf9acc893bb6bd41110347e5d5e4bd1d3c128ea90a", "hex");
            const d3 = Buffer.from("4ce8765e720c576f6f5a34ca380b3de5f0912e6e3cc5355542c363891e54594b", "hex");

            // Segment hashes (streamId, segmentSequenceNumber, dataHash)
            const s0 = abi.soliditySHA3(["string", "uint256", "bytes"], [streamId, 0, d0]);
            const s1 = abi.soliditySHA3(["string", "uint256", "bytes"], [streamId, 1, d1]);
            const s2 = abi.soliditySHA3(["string", "uint256", "bytes"], [streamId, 2, d2]);
            const s3 = abi.soliditySHA3(["string", "uint256", "bytes"], [streamId, 3, d3]);

            // Non-broadcaster (account 3) signatures over segments
            const bSig0 = utils.toBuffer(await web3.eth.sign(accounts[3], utils.bufferToHex(s0)));
            const bSig1 = utils.toBuffer(await web3.eth.sign(accounts[3], utils.bufferToHex(s1)));
            const bSig2 = utils.toBuffer(await web3.eth.sign(accounts[3], utils.bufferToHex(s2)));
            const bSig3 = utils.toBuffer(await web3.eth.sign(accounts[3], utils.bufferToHex(s3)));

            // Transcoded data hashes
            const tD0 = Buffer.from("42538602949f370aa331d2c07a1ee7ff26caac9cc676288f94b82eb2188b8465", "hex");
            const tD1 = Buffer.from("a0b37b8bfae8e71330bd8e278e4a45ca916d00475dd8b85e9352533454c9fec8", "hex");
            const tD2 = Buffer.from("9f2898da52dedaca29f05bcac0c8e43e4b9f7cb5707c14cc3f35a567232cec7c", "hex");
            const tD3 = Buffer.from("5a082c81a7e4d5833ee20bd67d2f4d736f679da33e4bebd3838217cb27bec1d3", "hex");

            // Transcode claims
            const tClaim0 = abi.soliditySHA3(["string", "uint256", "bytes", "bytes", "bytes"], [streamId, 0, d0, tD0, bSig0]);
            const tClaim1 = abi.soliditySHA3(["string", "uint256", "bytes", "bytes", "bytes"], [streamId, 1, d1, tD1, bSig1]);
            const tClaim2 = abi.soliditySHA3(["string", "uint256", "bytes", "bytes", "bytes"], [streamId, 2, d2, tD2, bSig2]);
            const tClaim3 = abi.soliditySHA3(["string", "uint256", "bytes", "bytes", "bytes"], [streamId, 3, d3, tD3, bSig3]);

            // Generate Merkle root
            const merkleTree = new MerkleTree([tClaim0, tClaim1, tClaim2, tClaim3]);
            const root = merkleTree.getHexRoot();

            // Account 1 claims work
            await instance.claimWork(0, 0, 3, root, {from: accounts[1]});

            // Get Merkle proof
            const proof = merkleTree.getHexProof(tClaim2);

            let threw = false;

            try {
                // Account 1 calls verify
                await instance.verify(0, 2, utils.bufferToHex(d2), utils.bufferToHex(tD2), utils.bufferToHex(bSig2), proof, {from: accounts[1]});
            } catch (err) {
                threw = true;
            }

            assert.isOk(threw, "verify did not throw when segment was not signed by the broadcaster for the job");
        });

        it("should fail if the transcode claim is not included in the last submitted Merkle root of transcode claims", async function() {
            const instance = await LivepeerProtocol.new(2, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            const a1Stake = 2000;

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(BLOCK_REWARD_CUT, FEE_SHARE, PRICE_PER_SEGMENT, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, a1Stake, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(a1Stake, accounts[1], {from: accounts[1]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            const streamId = "1";

            // Account 2 creates a transcoder job
            await instance.job(streamId, "0x1", 200, {from: accounts[2]});

            // Segment data hashes
            const d0 = Buffer.from("80084bf2fba02475726feb2cab2d8215eab14bc6bdd8bfb2c8151257032ecd8b", "hex");
            const d1 = Buffer.from("b039179a8a4ce2c252aa6f2f25798251c19b75fc1508d9d511a191e0487d64a7", "hex");
            const d2 = Buffer.from("263ab762270d3b73d3e2cddf9acc893bb6bd41110347e5d5e4bd1d3c128ea90a", "hex");
            const d3 = Buffer.from("4ce8765e720c576f6f5a34ca380b3de5f0912e6e3cc5355542c363891e54594b", "hex");

            // Segment hashes (streamId, segmentSequenceNumber, dataHash)
            const s0 = abi.soliditySHA3(["string", "uint256", "bytes"], [streamId, 0, d0]);
            const s1 = abi.soliditySHA3(["string", "uint256", "bytes"], [streamId, 1, d1]);
            const s2 = abi.soliditySHA3(["string", "uint256", "bytes"], [streamId, 2, d2]);
            const s3 = abi.soliditySHA3(["string", "uint256", "bytes"], [streamId, 3, d3]);

            // Broadcaster signatures over segments
            const bSig0 = utils.toBuffer(await web3.eth.sign(accounts[3], utils.bufferToHex(s0)));
            const bSig1 = utils.toBuffer(await web3.eth.sign(accounts[3], utils.bufferToHex(s1)));
            const bSig2 = utils.toBuffer(await web3.eth.sign(accounts[3], utils.bufferToHex(s2)));
            const bSig3 = utils.toBuffer(await web3.eth.sign(accounts[3], utils.bufferToHex(s3)));

            // Transcoded data hashes
            const tD0 = Buffer.from("42538602949f370aa331d2c07a1ee7ff26caac9cc676288f94b82eb2188b8465", "hex");
            const tD1 = Buffer.from("a0b37b8bfae8e71330bd8e278e4a45ca916d00475dd8b85e9352533454c9fec8", "hex");
            const tD2 = Buffer.from("9f2898da52dedaca29f05bcac0c8e43e4b9f7cb5707c14cc3f35a567232cec7c", "hex");
            const tD3 = Buffer.from("5a082c81a7e4d5833ee20bd67d2f4d736f679da33e4bebd3838217cb27bec1d3", "hex");

            // Transcode claims
            const tClaim0 = abi.soliditySHA3(["string", "uint256", "bytes", "bytes", "bytes"], [streamId, 0, d0, tD0, bSig0]);
            const tClaim1 = abi.soliditySHA3(["string", "uint256", "bytes", "bytes", "bytes"], [streamId, 1, d1, tD1, bSig1]);
            const tClaim2 = abi.soliditySHA3(["string", "uint256", "bytes", "bytes", "bytes"], [streamId, 2, d2, tD2, bSig2]);
            const tClaim3 = abi.soliditySHA3(["string", "uint256", "bytes", "bytes", "bytes"], [streamId, 3, d3, tD3, bSig3]);

            // Generate Merkle root
            const merkleTree = new MerkleTree([tClaim0, tClaim1, tClaim2, tClaim3]);
            const root = merkleTree.getHexRoot();

            // Account 1 claims work
            await instance.claimWork(0, 0, 3, root, {from: accounts[1]});

            // Get Merkle proof
            const proof = merkleTree.getHexProof(tClaim2);

            let threw = false;

            try {
                // Account 1 calls verify
                // This should fail because bSig3 is submitted instead of bSig2 which is part of the transcode claim tClaim2 being verified
                await instance.verify(0, 2, utils.bufferToHex(d2), utils.bufferToHex(tD2), utils.bufferToHex(bSig3), proof, {from: accounts[1]});
            } catch (err) {
                threw = true;
            }

            assert.isOk(threw, "verify did not throw when transcode claim was not included in last submitted Merkle root of transcode claims");
        });
    });
});
