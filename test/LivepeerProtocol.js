var LivepeerProtocol = artifacts.require("./LivepeerProtocol.sol");
var LivepeerToken = artifacts.require("./LivepeerToken.sol");

contract('LivepeerProtocol', function(accounts) {
    it("should initialize correctly", function() {
        return LivepeerProtocol.deployed().then(function(instance) {
            return instance.unbondingPeriod.call().then(function(val) {
                assert.equal(val.valueOf(), 60*60*24*10, "unbonding period wasn't 10 days");
                return instance.truebitAddress.call();
            }).then(function(val) {
                assert.equal(val, "0x647167a598171d06aecf0f5fa1daf3c5cc848df0", "Truebit value wasn't set");
            });
        });
    });

    it("should allow bonding", function() {
        return LivepeerProtocol.new({from: accounts[0]}).then(function(instance) {
            return instance.token.call().then(function(lpt_address) {
                var lpt = LivepeerToken.at(lpt_address);

                return lpt.balanceOf.call(accounts[0]).then(function(bal) {
                    console.log("Account 0 has " + bal.valueOf() + " token");
                    return;
                }).then(function() {
                    return lpt.approve(instance.address, 2000, {from: accounts[0]}).then(function() {
                        return lpt.allowance.call(accounts[0], instance.address);
                    }).then(function(allowance) {
                        console.log("Contracts spending balance is: " + allowance.valueOf());
                        
                        return instance.bond(1000, "0xb7e5575ddb750db2722929905e790de65ef2c078", {from: accounts[0], gas: 4000000});
                        return;
                    }).then(function() {
                        return instance.delegators.call(accounts[0]);
                    }).then(function(del) {
                        assert.equal(del[2], "0xb7e5575ddb750db2722929905e790de65ef2c078", "Bonding didn't work");
                        assert.equal(del[1].valueOf(), 1000, "Bonding value didn't work");
                    });
                });
            });
        });
    });
});

