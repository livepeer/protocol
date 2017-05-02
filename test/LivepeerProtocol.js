const BigNumber = require("bignumber.js");

const LivepeerProtocol = artifacts.require("./LivepeerProtocol.sol");
const LivepeerToken = artifacts.require("./LivepeerToken.sol");

function rpc(method, arg) {
    const req = {
        jsonrpc: "2.0",
        method: method,
        id: new Date().getTime()
    };

    if (arg) req.params = arg;

    return new Promise((resolve, reject) => {
        web3.currentProvider.sendAsync(req, (err, result) => {
            if (err) {
                reject(err);
            } else if (result && result.error){
                reject(new Error("RPC Error: " + (result.error.message || result.error)));
            } else {
                resolve(result);
            }
        });
    });
}

function tokenDecimals(value) {
    const bigVal = new BigNumber(value);
    const decimals = new BigNumber(Math.pow(10, 18));

    return bigVal.times(decimals);
}

// Change block time using TestRPC call evm_setTimestamp
// https://github.com/numerai/contract/blob/master/test/numeraire.js
web3.evm = web3.evm || {};
web3.evm.increaseTime = function(time) {
    return rpc('evm_increaseTime', [time]);
};

contract('LivepeerProtocol', function(accounts) {
    it("should initialize correctly", async function() {
        const instance = await LivepeerProtocol.deployed();

        const unbondingPeriod = await instance.unbondingPeriod.call();
        assert.equal(unbondingPeriod.toNumber(), 60*60*24*10, "unbonding period was not 10 days");

        const truebitAddress = await instance.truebitAddress.call();
        assert.equal(truebitAddress, "0x647167a598171d06aecf0f5fa1daf3c5cc848df0", "Truebit value was not set");
    });

    it("should allow bonding", async function() {
        const instance = await LivepeerProtocol.new({from: accounts[0]});
        const lptAddress = await instance.token.call();
        const lpt = await LivepeerToken.at(lptAddress);

        const balance = await lpt.balanceOf.call(accounts[0]);
        console.log("Account 0 has " + balance.toNumber() + " token");

        // Approve token transfer
        await lpt.approve(instance.address, 2000, {from: accounts[0]});
        const allowance = await lpt.allowance.call(accounts[0], instance.address);
        assert.equal(allowance, 2000, "token allowance not properly set");

        // Bond
        await instance.bond(1000, "0xb7e5575ddb750db2722929905e790de65ef2c078", {from: accounts[0], gas: 4000000});
        const delegator = await instance.delegators.call(accounts[0]);
        assert.equal(delegator[1].toNumber(), 1000, "bond with staked amount did not work");
        assert.equal(delegator[2], "0xb7e5575ddb750db2722929905e790de65ef2c078", "bond to transcoder did not work");
    });
});
