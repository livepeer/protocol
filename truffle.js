require("babel-register")
require("babel-polyfill")

const KeystoreProvider = require("truffle-keystore-provider")
const Web3 = require("web3")

let mochaConfig = {}

// CLI options
for (let i = 0; i < process.argv.length; i++) {
    switch (process.argv[i]) {
        case "-g":
        case "--grep":
            if (process.argv.length == i + 1 || process.argv[i+1].startsWith("-")) {
                console.error(`${process.argv[i]} option requires argument`)
                process.exit(1)
            }
            const re = new RegExp(process.argv[i + 1])
            mochaConfig.grep = new RegExp(process.argv[i + 1])
            console.log("RegExp: " + i + ": " + re)
            break
        case "-r":
        case "--report":
            mochaConfig.reporter = "eth-gas-reporter"
            mochaConfig.reporterOptions = {
                rst: true,
                currency: "USD"
            }
            break
    }
}

const memoizeProviderCreator = () => {
    let keystoreProviders = {}

    return (account, dataDir, providerUrl, readOnly) => {
        if (readOnly) {
            return new Web3.providers.HttpProvider(providerUrl)
        } else {
            if (providerUrl in keystoreProviders) {
                return keystoreProviders[providerUrl]
            } else {
                const provider = new KeystoreProvider(account, dataDir, providerUrl)
                keystoreProviders[providerUrl] = provider
                return provider
            }
        }
    }
}

const createProvider = memoizeProviderCreator()

module.exports = {
    networks: {
        development: {
            host: "localhost",
            port: 8545,
            network_id: "*", // Match any network id
            gas: 8000000
        },
        // This network should be used when running unit tests so migrations can be skipped
        unitTest: {
            host: "localhost",
            port: 8545,
            network_id: "*",
            gas: 8000000
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
            provider: () => {
                return createProvider(process.env.LPTESTNET_ACCOUNT, process.env.DATA_DIR, "http://ethrpc-testnet.livepeer.org:8545", process.env.READ_ONLY)
            },
            network_id: 858585,
            gas: 6600000
        },
        rinkeby: {
            provider: () => {
                return createProvider(process.env.RINKEBY_ACCOUNT, process.env.DATA_DIR, "https://rinkeby.infura.io", process.env.READ_ONLY)
            },
            network_id: 4,
            gas: 6600000
        },
        rinkebyDryRun: {
            provider: () => {
                return createProvider(process.env.RINKEBY_ACCOUNT, process.env.DATA_DIR, "https://rinkeby.infura.io", process.env.READ_ONLY)
            },
            network_id: 4,
            gas: 6600000
        },
        mainnet: {
            provider: () => {
                return createProvider(process.env.MAINNET_ACCOUNT, process.env.DATA_DIR, "https://mainnet.infura.io", process.env.READ_ONLY)
            },
            network_id: 1,
            gas: 6600000
        }
    },
    compilers: {
        solc: {
            version: "0.5.11",
            docker: true,
            parser: "solcjs",
            settings: {
                optimizer: {
                    enabled: true,
                    runs: 200
                }
            }
        }
    },
    mocha: mochaConfig,
    plugins: [
        "solidity-coverage"
    ]
}
