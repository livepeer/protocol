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
        this.sendAsync('evm_increaseTime', [time]);
    }
}
