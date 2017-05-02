import BigNumber from "bignumber.js";
import RPC from "../utils/rpc";
import { toSmallestUnits } from "../utils/bn_util";

const LivepeerProtocol = artifacts.require("./LivepeerProtocol.sol");
const LivepeerToken = artifacts.require("./LivepeerToken.sol");

contract('LivepeerProtocol', function(accounts) {
    let rpc;

    before(function() {
        rpc = new RPC(web3);
    });

    it("should initialize correctly", async function() {
        const instance = await LivepeerProtocol.deployed();

        const unbondingPeriod = await instance.unbondingPeriod.call();
        assert.equal(unbondingPeriod.toNumber(), 60*60*24*10, "unbonding period was not 10 days");

        const truebitAddress = await instance.truebitAddress.call();
        assert.equal(truebitAddress, "0x647167a598171d06aecf0f5fa1daf3c5cc848df0", "Truebit value was not set");
    });

    it("should allow becoming a transcoder", async function() {
        const instance = await LivepeerProtocol.new({from: accounts[0]});

        await instance.transcoder({from: accounts[1]});

        const transcoder = await instance.transcoders.call(accounts[1]);
        assert.equal(transcoder[0], accounts[1], "becoming a transcoder did not work");
    });

    it("should allow bonding", async function() {
        const instance = await LivepeerProtocol.new({from: accounts[0]});
        const lptAddress = await instance.token.call();
        const lpt = await LivepeerToken.at(lptAddress);

        // Approve token transfer
        await lpt.approve(instance.address, 2000, {from: accounts[0]});
        const allowance = await lpt.allowance.call(accounts[0], instance.address);
        assert.equal(allowance, 2000, "token allowance not properly set");

        // Bond
        await instance.bond(1000, "0xb7e5575ddb750db2722929905e790de65ef2c078", {from: accounts[0], gas: 4000000});
        const delegator = await instance.delegators.call(accounts[0]);
        assert.equal(delegator[1].toNumber(), 1000, "bond with staked amount did not work");
        assert.equal(delegator[2], "0xb7e5575ddb750db2722929905e790de65ef2c078", "bond to transcoder did not work");

        // Fast forward 1 round
        await rpc.increaseTime(24 * 60 * 60);

        // Next round
        await instance.nextRound({from: accounts[0]});

        // Fast forward 1 round
        await rpc.increaseTime(24 * 60 * 60);

        // Next round
        await instance.nextRound({from: accounts[0]});

        // Finalize bond
        await instance.finalizeBond({from: accounts[0]});
    });

    it("should allow updating and moving bonded stake", async function() {
        const instance = await LivepeerProtocol.new({from: accounts[0]});
        const lptAddress = await instance.token.call();
        const lpt = await LivepeerToken.at(lptAddress);

        // Transcoder
        await instance.transcoder({from: accounts[1]});

        // Approve token transfer
        await lpt.approve(instance.address, 2000, {from: accounts[0]});

        // Bond
        await instance.bond(1000, "0xb7e5575ddb750db2722929905e790de65ef2c078", {from: accounts[0], gas: 4000000});

        // Fast forward 1 round
        await rpc.increaseTime(24 * 60 * 60);

        // Next round
        await instance.nextRound({from: accounts[0]});

        // Fast forward 1 round
        await rpc.increaseTime(24 * 60 * 60);

        // Next round
        await instance.nextRound({from: accounts[0]});

        // Finalize bond
        await instance.finalizeBond({from: accounts[0]});

        // Update bond
        await instance.bond(1000, "0xb7e5575ddb750db2722929905e790de65ef2c078", {from: accounts[0], gas: 4000000});
        let delegator = await instance.delegators.call(accounts[0]);
        assert.equal(delegator[1].toNumber(), 1000 + 1000, "updating bonded stake did not work");

        // Move bond
        await instance.bond(0, accounts[1], {from: accounts[0], gas: 4000000});
        delegator = await instance.delegators.call(accounts[0]);
        assert.equal(delegator[2], accounts[1], "moving bonded stake did not work");
    });

    it("should allow unbonding and withdrawal", async function() {
        const instance = await LivepeerProtocol.new({from: accounts[0]});
        const lptAddress = await instance.token.call();
        const lpt = await LivepeerToken.at(lptAddress);

        // Approve token transfer
        await lpt.approve(instance.address, 2000, {from: accounts[0]});

        // Bond
        await instance.bond(1000, "0xb7e5575ddb750db2722929905e790de65ef2c078", {from: accounts[0], gas: 4000000});

        // Fast forward 1 round
        await rpc.increaseTime(24 * 60 * 60);

        // Next round
        await instance.nextRound({from: accounts[0]});

        // Fast forward 1 round
        await rpc.increaseTime(24 * 60 * 60);

        // Next round
        await instance.nextRound({from: accounts[0]});

        // Finalize bond
        await instance.finalizeBond({from: accounts[0]});

        // Unbond
        await instance.unbond({from: accounts[0]});

        // Fast forward through unbounding period
        await rpc.increaseTime(10 * 24 * 60 * 60);

        // Withdraw
        await instance.withdraw({from: accounts[0]});
        const balance = await lpt.balanceOf.call(accounts[0]);
        assert.equal(balance.toNumber(), toSmallestUnits(3), "withdrawing bonded tokens did not work");
    });
});
