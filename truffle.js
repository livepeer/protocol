require("babel-register")
require("babel-polyfill")

module.exports = {
    networks: {
        development: {
            host: "localhost",
            port: 8545,
            network_id: "*" // Match any network id
        },
        lpTestNet: {
            from: "0x0161e041aad467a890839d5b08b138c1e6373072",
            host: "localhost",
            port: 8545,
            network_id: 777
        }
    }
};
