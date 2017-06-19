import { soliditySha3 } from "../utils/soliditySha3";
import utils from "ethereumjs-util";

const ECVerify = artifacts.require("./ECVerify.sol");

contract('ECVerify', function(accounts) {
    let ecverify;

    before(async function() {
        ecverify = await ECVerify.new();
    });

    it("should verify a signature", async function() {
        // let signer = "0x2cc1166f6212628a0deef2b33befb2187d35b86c";
        // let message = '0x7dbaf558b0a1a5dc7a67202117ab143c1d8605a983e4a743bc06fcc03162dc0d'; // web3.sha3('OpenZeppelin')
        // let signature = '0x5d99b6f7f6d1f73d1a26497f2b1c89b24c0993913f86e9a2d02cd69887d9c94f3c880358579d811b21dd1b7fd9bb01c1d81d10e69f0384e675c32b39643be89200';
        let signer = accounts[0];
        let message = utils.bufferToHex(soliditySha3(1, 0, "0x7dbaf558b0a1a5dc7a67202117ab143c1d8605a983e4a743bc06fcc03162dc0d"));
        let signature = await web3.eth.sign(accounts[0], message);

        let result = await ecverify.ecverify(message, signature, signer);
        console.log(result);
        assert.isOk(result);
    });

    it("should return false for an invalid signature", async function() {
        let signer = accounts[0];
        let message = utils.bufferToHex(soliditySha3(1, 0, "0x7dbaf558b0a1a5dc7a67202117ab143c1d8605a983e4a743bc06fcc03162dc0d"));
        let signature = '0x5d99b6f7f6d1f73d1a26497f2b1c89b24c0993913f86e9a2d02cd69887d9c94f3c880358579d811b21dd1b7fd9bb01c1d81d10e69f0384e675c32b39643be89200';

        let result = await ecverify.ecverify(message, signature, signer);
        console.log(result);
        assert.isNotOk(result);
    });
});
