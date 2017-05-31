import RPC from "../utils/rpc";

const LivepeerToken = artifacts.require("./LivepeerToken.sol");

contract('LivepeerToken', function(accounts) {
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

    it("should be a Livepeer Token", async function() {
        const instance = await LivepeerToken.deployed();

        const name = await instance.name.call();
        assert.equal(name, "Livepeer Token", "Token didn't have the right name");

        const sym = await instance.symbol.call();
        assert.equal(sym, "LPT", "Symbol wasn't LPT");
    });

    it("should be owned by a first account", async function() {
        const instance = await LivepeerToken.deployed();

        const owner = await instance.owner.call();
        assert.equal(owner, accounts[0], "LPT was not owned by the first account");
    });

    it("should be mintable", async function() {
        const lpt = await LivepeerToken.new();

        const balance0 = await lpt.balanceOf.call(accounts[0]);
        assert.equal(balance0.valueOf(), 0, "0 wasn't in the first account");

        await lpt.mint(accounts[0], 10000);

        const balance01 = await lpt.balanceOf.call(accounts[0]);
        assert.equal(balance01.valueOf(), 10000, "10000 wasn't in the first account");

        await lpt.mint(accounts[1], 25);

        const balance1 = await lpt.balanceOf.call(accounts[1]);
        assert.equal(balance1.valueOf(), 25, "25 wasn't in the second account");
    });
});
