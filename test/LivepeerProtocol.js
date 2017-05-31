import BigNumber from "bignumber.js";
import RPC from "../utils/rpc";
import { toSmallestUnits } from "../utils/bn_util";

const LivepeerProtocol = artifacts.require("./LivepeerProtocol.sol");
const LivepeerToken = artifacts.require("./LivepeerToken.sol");

// Delegator status
const INACTIVE = 0;
const PENDING = 1;
const BONDED = 2;
const UNBONDING = 3;

// Round length
const ROUND_LENGTH = 50;

// Cycles per round
const CYCLES_PER_ROUND = 2;

// Unbonding period
const UNBONDING_PERIOD = 2;

contract('LivepeerProtocol', function(accounts) {
    let rpc;
    let snapshotId;

    before(function() {
        rpc = new RPC(web3);
    });

    beforeEach("snapshot checkpoint to revert back to later", async function() {
        snapshotId = await rpc.snapshot();
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
            await instance.transcoder(10, {from: accounts[1]});

            const transcoder = await instance.transcoders.call(accounts[1]);
            assert.equal(transcoder[0], accounts[1], "becoming a transcoder did not work");

            // Approve token transfer for account 1
            await lpt.approve(instance.address, 2000, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(2000, accounts[1], {from: accounts[1]});

            const isActiveTranscoder = await instance.isActiveTranscoder(accounts[1]);
            assert.isOk(isActiveTranscoder, "active transcoder pool did not update correctly");
        });

        it("should fail for blockRewardCut less than 0", async function() {
            const instance = await LivepeerProtocol.new(1, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});

            let threw = false;

            try {
                await instance.transcoder(-1, {from: accounts[1]});
            } catch (err) {
                threw = true;
            }

            assert.isOk(threw, "transcoder registration did not throw for blockRewardCut less than 0");
        });

        it("should fail for blockRewardCut greater than 100", async function() {
            const instance = await LivepeerProtocol.new(1, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});

            let threw = false;

            try {
                await instance.transcoder(101, {from: accounts[1]});
            } catch (err) {
                threw = true;
            }

            assert.isOk(threw, "transcoder registration did not throw for blockRewardCut greater than 100");
        });
    });


    it("should allow bonding", async function() {
        const instance = await LivepeerProtocol.new(1, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
        const lptAddress = await instance.token.call();
        const lpt = await LivepeerToken.at(lptAddress);

        // Transfer tokens
        await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

        // Register account 1 as transcoder 1
        await instance.transcoder(10, {from: accounts[1]});

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
        assert.equal(delegatorStatus, PENDING, "delegator did not transition to bonded");

        // Fast forward 2 rounds
        await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH, 2);

        delegatorStatus = await instance.delegatorStatus.call(accounts[0]);
        assert.equal(delegatorStatus, BONDED, "delegator did not transition to bonded");
    });

    it("should allow updating and moving bonded stake", async function() {
        const instance = await LivepeerProtocol.new(1, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
        const lptAddress = await instance.token.call();
        const lpt = await LivepeerToken.at(lptAddress);

        // Transfer tokens
        await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

        // Register account 1 as transcoder 1
        await instance.transcoder(10, {from: accounts[1]});

        // Approve token transfer for account 1
        await lpt.approve(instance.address, 2000, {from: accounts[1]});

        // Account 1 bonds to self as transcoder
        await instance.bond(2000, accounts[1], {from: accounts[1]});

        // Approve token transfer for account 0
        await lpt.approve(instance.address, 2000, {from: accounts[0]});

        // Account 0 bonds to transcoder 1
        await instance.bond(1000, accounts[1], {from: accounts[0]});

        // Fast forward 2 rounds
        await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH, 2);

        // Transfer tokens
        await lpt.transfer(accounts[2], toSmallestUnits(1), {from: accounts[0]});

        // Register account 2 as transcoder 2
        await instance.transcoder(10, {from: accounts[2]});

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
        await instance.transcoder(10, {from: accounts[1]});

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
        await instance.transcoder(10, {from: accounts[2]});

        // Approve token transfer for account 2
        await lpt.approve(instance.address, 2000, {from: accounts[2]});

        // Account 2 bonds to self as transcoder
        await instance.bond(2000, accounts[2], {from: accounts[2]});

        let isActiveTranscoder = await instance.isActiveTranscoder(accounts[1]);
        assert.isOk(isActiveTranscoder, "transcoder 1 has the most stake and is not active");

        let isCandidateTranscoder = await instance.isCandidateTranscoder(accounts[2]);
        assert.isOk(isCandidateTranscoder, "transcoder 2 has less stake than transcoder 2 and is not a candidate");

        // Fast forward 2 rounds
        await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH, 2);

        // Account 0 unbonds
        await instance.unbond({from: accounts[0]});

        const delegatorStatus = await instance.delegatorStatus.call(accounts[0]);
        assert.equal(delegatorStatus, UNBONDING, "delegator did not transition to unbonding");

        // Fast forward through unbonding period
        await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH, UNBONDING_PERIOD);

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
        await instance.transcoder(10, {from: accounts[1]});

        // approve token transfer for account 1
        await lpt.approve(instance.address, 2000, {from: accounts[1]});

        // account 1 bonds to self as transcoder
        await instance.bond(2000, accounts[1], {from: accounts[1]});

        // approve token transfer
        await lpt.approve(instance.address, 2000, {from: accounts[0]});

        // account 0 bonds to transcoder 1
        await instance.bond(1000, accounts[1], {from: accounts[0]});

        // Fast forward 2 rounds
        await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH, 2);

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
            await instance.transcoder(10, {from: accounts[1]});

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
            assert.equal(delegatorStatus, UNBONDING, "resignAsTranscoder did not cause delegators to unbond");

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
            await instance.transcoder(10, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, 2000, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(2000, accounts[1], {from: accounts[1]});

            // Fast forward 1 round
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            let elected = await instance.electCurrentActiveTranscoder();
            assert.equal(elected, accounts[1], "initialize round did not set current round active transcoders");

            // Transfer tokens
            await lpt.transfer(accounts[2], toSmallestUnits(1), {from: accounts[0]});

            // Register account 2 as transcoder 2
            await instance.transcoder(10, {from: accounts[2]});

            // Approve token transfer for account 2
            await lpt.approve(instance.address, 3000, {from: accounts[2]});

            // Account 2 bonds to self as transcoder
            await instance.bond(3000, accounts[2], {from: accounts[2]});

            // Fast forward 1 rounds
            await rpc.waitUntilNextBlockMultiple(20, ROUND_LENGTH);

            await instance.initializeRound();

            elected = await instance.electCurrentActiveTranscoder();
            assert.equal(elected, accounts[2], "initialize round did not set current round active transcoders after stake change");
        });

        it("should not change current transcoder set if initializeRound is not called", async function() {
            const instance = await LivepeerProtocol.new(1, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(10, {from: accounts[1]});

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
            await instance.transcoder(10, {from: accounts[2]});

            // Approve token transfer for account 2
            await lpt.approve(instance.address, 3000, {from: accounts[2]});

            // Account 2 bonds to self as transcoder
            await instance.bond(3000, accounts[2], {from: accounts[2]});

            const elected = await instance.electCurrentActiveTranscoder();
            assert.equal(elected, accounts[1], "current transcoder set changed without calling initializeRound");
        });

        it("should fail if current round is already initialized", async function() {
            const instance = await LivepeerProtocol.new(1, ROUND_LENGTH, CYCLES_PER_ROUND, {from: accounts[0]});
            const lptaddress = await instance.token.call();
            const lpt = await LivepeerToken.at(lptaddress);

            // Transfer tokens
            await lpt.transfer(accounts[1], toSmallestUnits(1), {from: accounts[0]});

            // Register account 1 as transcoder 1
            await instance.transcoder(10, {from: accounts[1]});

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
            await instance.transcoder(10, {from: accounts[2]});

            // Approve token transfer for account 2
            await lpt.approve(instance.address, 3000, {from: accounts[2]});

            // Account 2 bonds to self as transcoder
            await instance.bond(3000, accounts[2], {from: accounts[2]});

            await instance.initializeRound();

            const elected = await instance.electCurrentActiveTranscoder();
            assert.equal(elected, accounts[1], "initialize round did not return early when it was already called for the current round");
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
            await instance.transcoder(10, {from: accounts[1]});

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
            await instance.transcoder(10, {from: accounts[1]});

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
            await instance.transcoder(10, {from: accounts[1]});

            // Approve token transfer for account 1
            await lpt.approve(instance.address, 2000, {from: accounts[1]});

            // Account 1 bonds to self as transcoder
            await instance.bond(2000, accounts[1], {from: accounts[1]});

            // Transfer tokens
            await lpt.transfer(accounts[2], toSmallestUnits(1), {from: accounts[0]});

            // Register account 2 as transcoder 2
            await instance.transcoder(10, {from: accounts[2]});

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
            await instance.transcoder(10, {from: accounts[1]});

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
            await instance.transcoder(10, {from: accounts[1]});

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
});
