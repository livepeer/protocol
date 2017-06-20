var TranscodeJobs = artifacts.require("./TranscodeJobs.sol");

import abi from "ethereumjs-abi";
import BigNumber from "bignumber.js";

contract('TranscodeJobs', function(accounts) {
    let transcodeJobs;

    before(async function() {
        transcodeJobs = await TranscodeJobs.new();
    });

    describe("shouldVerifySegment", function() {
        it("should return true for a segment eligible for verification", async function() {
            let segNum = 0;
            const blockNum = web3.eth.blockNumber;
            const block = await web3.eth.getBlock(blockNum);
            const blockHash = block.hash;
            const verificationRate = 4;

            // Find an eligible segment
            let hash = abi.soliditySHA3(["uint256", "bytes", "uint256"], [blockNum, Buffer.from(blockHash.slice(2), "hex"), segNum]).toString("hex");
            let hashNum = new BigNumber(hash, 16);
            let res = hashNum.mod(verificationRate);

            while (res != 0) {
                segNum++;
                hash = abi.soliditySHA3(["uint256", "bytes", "uint256"], [blockNum, Buffer.from(blockHash.slice(2), "hex"), segNum]).toString("hex");
                hashNum = new BigNumber(hash, 16);
                res = hashNum.mod(verificationRate);
            }

            const startSegNum = segNum;
            const endSegNum = startSegNum + 5;

            const result = await transcodeJobs.shouldVerifySegment(segNum, startSegNum, endSegNum, blockNum, blockHash, verificationRate);
            assert.isOk(result, "shouldVerifySegment did not return true for segment eligible for verification");
        });

        it("should return false if the segment is not in the last claimed segment range", async function() {
            const segNum = 5;
            const startSegNum = 6;
            const endSegNum = 10;
            const blockNum = web3.eth.blockNumber;
            const block = await web3.eth.getBlock(blockNum);
            const blockHash = block.hash;
            const verificationRate = 4;

            const result = await transcodeJobs.shouldVerifySegment(segNum, startSegNum, endSegNum, blockNum, blockHash, verificationRate);
            assert.isNotOk(result, "shouldVerifySegment did not return false when segment was not in last claimed segment range");
        });

        it("should return false if the segment is not eligible for verification", async function() {
            let segNum = 0;
            const blockNum = web3.eth.blockNumber;
            const block = await web3.eth.getBlock(blockNum);
            const blockHash = block.hash;
            const verificationRate = 4;

            // Find an ineligble segment
            let hash = abi.soliditySHA3(["uint256", "bytes", "uint256"], [blockNum, Buffer.from(blockHash.slice(2), "hex"), segNum]).toString("hex");
            let hashNum = new BigNumber(hash, 16);
            let res = hashNum.mod(verificationRate);

            while (res == 0) {
                segNum++;
                hash = abi.soliditySHA3(["uint256", "bytes", "uint256"], [blockNum, Buffer.from(blockHash.slice(2), "hex"), segNum]).toString("hex");
                hashNum = new BigNumber(hash, 16);
                res = hashNum.mod(verificationRate);
            }

            const startSegNum = segNum;
            const endSegNum = startSegNum + 5;

            const result = await transcodeJobs.shouldVerifySegment(segNum, startSegNum, endSegNum, blockNum, blockHash, verificationRate);
            assert.isNotOk(result, "shouldVerifySegment did not return false for segment ineligible for verification");
        });
    });
});
