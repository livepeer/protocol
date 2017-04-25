var LivepeerToken = artifacts.require("./LivepeerToken.sol");

contract('LivepeerToken', function(accounts) {
    it("should be a Livepeer Token", function() {
        return LivepeerToken.deployed().then(function(instance) {
            return instance.name.call().then(function(name) {
                assert.equal(name, "Livepeer Token", "Token didn't have the right name");
                return instance.symbol.call();
            }).then(function(sym) {
                assert.equal(sym, "LPT", "Symbol wasn't LPT");
            });
        });
    });

    it("should be owned by a first account", function() {
        return LivepeerToken.deployed().then(function(instance) {
            return instance.owner.call().then(function(owner) {
                assert.equal(owner, accounts[0], "LPT was not owned by the first account");
            });
        });
    });
    
    it("should be mintable", function() {
        var lpt;
        return LivepeerToken.new().then(function(instance) {
            lpt = instance;
            return lpt.balanceOf.call(accounts[0]);
        }).then(function(balance) {
            assert.equal(balance.valueOf(), 10000, "10000 wasn't in the first account");
            // Mint some token
            return lpt.mint(accounts[1], 25);
        }).then(function(txnId) {
            return lpt.balanceOf.call(accounts[1]);
        }).then(function(balance) {
            assert.equal(balance.valueOf(), 25, "25 wasn't in the second account");
        });
    });
});
