export default class RPC {
    constructor(web3) {
        this.web3 = web3;
    }

    sendAsync(method, arg) {
        const req = {
            jsonrpc: "2.0",
            method: method,
            id: new Date().getTime()
        };

        if (arg) req.params = arg;

        return new Promise((resolve, reject) => {
            this.web3.currentProvider.sendAsync(req, (err, result) => {
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

    // Change block time using TestRPC call evm_setTimestamp
    // https://github.com/numerai/contract/blob/master/test/numeraire.js
    increaseTime(time) {
        return this.sendAsync("evm_increaseTime", [time]);
    }

    snapshot() {
        return this.sendAsync("evm_snapshot")
            .then(res => res.result);
    }

    revert(snapshotId) {
        return this.sendAsync("evm_revert", [snapshotId]);
    }

    // Wait a number of blocks using evm_mine and evm_increaseTime
    // https://github.com/DigixGlobal/tempo
    wait(seconds = 20, blocks = 1) {
        return new Promise((resolve) => {
            return this.web3.eth.getBlock('latest', (e, { number }) => {
                resolve(blocks + number);
            });
        }).then((targetBlock) => {
            return this.waitUntilBlock(seconds, targetBlock);
        });
    }

    waitUntilBlock(seconds, targetBlock) {
        return new Promise((resolve) => {
            const asyncIterator = () => {
                return this.web3.eth.getBlock('latest', (e, { number }) => {
                    if (number >= targetBlock - 1) {
                        return this.sendAsync('evm_increaseTime', [seconds])
                            .then(() => this.sendAsync('evm_mine')).then(resolve);
                    }
                    return this.sendAsync('evm_mine').then(asyncIterator);
                });
            };
            asyncIterator();
        });
    }

    nextRoundBlock(currentBlockNum, roundLength) {
        if (roundLength === 0) {
            return currentBlockNum;
        }

        const remainder = currentBlockNum % roundLength;

        if (remainder === 0) {
            return currentBlockNum;
        }

        return currentBlockNum + roundLength - remainder;
    }

    waitUntilNextRoundBlock(seconds = 20, roundLength, rounds = 1) {
        return new Promise((resolve) => {
            return this.web3.eth.getBlockNumber((e, blockNum) => {
                resolve(blockNum);
            });
        }).then(blockNum => {
            const additionalBlocks = (rounds - 1) * roundLength;
            return this.waitUntilBlock(seconds, this.nextRoundBlock(blockNum, roundLength) + additionalBlocks);
        });
    }
}
