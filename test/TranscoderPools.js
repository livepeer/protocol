const TranscoderPoolsMock = artifacts.require("./TranscoderPoolsMock.sol");

contract("TranscoderPools", function(accounts) {
    it("should initialize correctly", async function() {
        const transcoderPoolsMock = await TranscoderPoolsMock.new();

        await transcoderPoolsMock.init(10, 10);

        const activePoolMaxSize = await transcoderPoolsMock.activePoolMaxSize.call();
        assert.equal(activePoolMaxSize, 10, "transcoder pools did not initialize active pool with correct max size");

        const candidatePoolMaxSize = await transcoderPoolsMock.candidatePoolMaxSize.call();
        assert.equal(candidatePoolMaxSize, 10, "transcoder pools did not initialize candidate pool with correct max size");
    });

    it("should add a transcoder", async function() {
        const transcoderPoolsMock = await TranscoderPoolsMock.new();

        await transcoderPoolsMock.init(2, 2);

        await transcoderPoolsMock.addTranscoder(accounts[0], 10);

        let isActiveTranscoder = await transcoderPoolsMock.isActiveTranscoder(accounts[0]);
        assert.isOk(isActiveTranscoder, "add transcoder did not set transcoder 1 as active");

        await transcoderPoolsMock.addTranscoder(accounts[1], 15);

        isActiveTranscoder = await transcoderPoolsMock.isActiveTranscoder(accounts[1]);
        assert.isOk(isActiveTranscoder, "add transcoder did not set transcoder 2 as active");

        await transcoderPoolsMock.addTranscoder(accounts[2], 12);

        isActiveTranscoder = await transcoderPoolsMock.isActiveTranscoder(accounts[2]);
        assert.isOk(isActiveTranscoder, "add transcoder did not set transcoder 3 as active");

        let isCandidateTranscoder = await transcoderPoolsMock.isCandidateTranscoder(accounts[0]);
        assert.isOk(isCandidateTranscoder, "add transcoder did not set transcoder 1 as candidate");
    });

    it("should fail to add a transcoder if it exists", async function() {
        const transcoderPoolsMock = await TranscoderPoolsMock.new();

        await transcoderPoolsMock.init(10, 10);

        await transcoderPoolsMock.addTranscoder(accounts[0], 10);

        let threw = false;

        try {
            await transcoderPoolsMock.addTranscoder(accounts[0], 10);
        } catch (err) {
            threw = true;
        }

        assert.isOk(threw, "add transcoder did not throw for existing transcoder");
    });

    it("should increase transcoder stake", async function() {
        const transcoderPoolsMock = await TranscoderPoolsMock.new();

        await transcoderPoolsMock.init(2, 2);

        await transcoderPoolsMock.addTranscoder(accounts[0], 10);
        await transcoderPoolsMock.addTranscoder(accounts[1], 15);
        await transcoderPoolsMock.addTranscoder(accounts[2], 5);

        await transcoderPoolsMock.increaseTranscoderStake(accounts[2], 10);

        let isActiveTranscoder = await transcoderPoolsMock.isActiveTranscoder(accounts[2]);
        assert.isOk(isActiveTranscoder, "increase transcoder stake did not set transcoder 2 as active");

        let isCandidateTranscoder = await transcoderPoolsMock.isCandidateTranscoder(accounts[0]);
        assert.isOk(isCandidateTranscoder, "increase transcoder stake did not set transcoder 0 as candidate");
    });

    it("should fail to increase transcoder stake for non-existent transcoder", async function() {
        const transcoderPoolsMock = await TranscoderPoolsMock.new();

        await transcoderPoolsMock.init(10, 10);

        await transcoderPoolsMock.addTranscoder(accounts[0], 10);

        let threw = false;

        try {
            await transcoderPoolsMock.increaseTranscoderStake(accounts[1], 10);
        } catch (err) {
            threw = true;
        }

        assert.isOk(threw, "increase transcoder stake did not throw for non-existent transcoder");
    });

    it("should remove a transcoder", async function() {
        const transcoderPoolsMock = await TranscoderPoolsMock.new();

        await transcoderPoolsMock.init(2, 2);

        await transcoderPoolsMock.addTranscoder(accounts[0], 10);
        await transcoderPoolsMock.addTranscoder(accounts[1], 15);
        await transcoderPoolsMock.addTranscoder(accounts[2], 8);

        await transcoderPoolsMock.removeTranscoder(accounts[1]);

        let isActiveTranscoder = await transcoderPoolsMock.isActiveTranscoder(accounts[2]);
        assert.isOk(isActiveTranscoder, "remove transcoder did not promote a candidate transcoder");
    });

    it("should decrease transcoder stake", async function() {
        const transcoderPoolsMock = await TranscoderPoolsMock.new();

        await transcoderPoolsMock.init(2, 2);

        await transcoderPoolsMock.addTranscoder(accounts[0], 10);
        await transcoderPoolsMock.addTranscoder(accounts[1], 15);
        await transcoderPoolsMock.addTranscoder(accounts[2], 8);

        await transcoderPoolsMock.decreaseTranscoderStake(accounts[1], 10);

        let isActiveTranscoder = await transcoderPoolsMock.isActiveTranscoder(accounts[2]);
        assert.isOk(isActiveTranscoder, "decrease transcoder stake did not set transcoder 2 as active");

        let isCandidateTranscoder = await transcoderPoolsMock.isCandidateTranscoder(accounts[1]);
        assert.isOk(isCandidateTranscoder, "decrease transcoder stake did not set transcoder 1 as candidate");
    });

    it("should fail to increase transcoder stake for non-existent transcoder", async function() {
        const transcoderPoolsMock = await TranscoderPoolsMock.new();

        await transcoderPoolsMock.init(10, 10);

        await transcoderPoolsMock.addTranscoder(accounts[0], 10);

        let threw = false;

        try {
            await transcoderPoolsMock.decreaseTranscoderStake(accounts[1], 10);
        } catch (err) {
            threw = true;
        }

        assert.isOk(threw, "decrease transcoder stake did not throw for non-existent transcoder");
    });
});
