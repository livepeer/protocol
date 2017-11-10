require("babel-register")
require("babel-polyfill")

module.exports = {
    networks: {
        development: {
            host: "localhost",
            port: 8545,
            network_id: "*", // Match any network id
            gas: 6700000
        },
        testrpc: {
            host: "testrpc",
            port: 8545,
            network_id: "*",
            gas: 6700000
        },
        parityDev: {
            host: "parity-dev",
            port: 8545,
            network_id: 7777,
            gas: 6700000
        },
        gethDev: {
            host: "geth-dev",
            port: 8545,
            network_id: 7777,
            gas: 6700000
        },
        lpTestNet: {
            from: "0x0161e041aad467a890839d5b08b138c1e6373072",
            host: "localhost",
            port: 8545,
            network_id: 777,
            gas: 6700000
        }
    },
    solc: {
        optimizer: {
            enabled: true,
            runs: 200
        }
    },
    solc: {
        optimizer: {
            enabled: true,
            runs: 200
        }
    }
}
