var LivepeerProtocol = artifacts.require("./LivepeerProtocol.sol");

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

});

