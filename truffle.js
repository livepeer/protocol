require("babel-register")
require("babel-polyfill")

const KeystoreProvider = require("truffle-keystore-provider")
const Web3 = require("web3")

let mochaConfig = {}

// Enable Mocha's --grep feature
for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i]
    if (arg !== "-g" &&  arg !== "--grep") continue
    if (++i >= process.argv.length) {
        console.error(arg + " option requires argument")
        process.exit(1)
    }

    const re = new RegExp(process.argv[i])
    mochaConfig.grep = new RegExp(process.argv[i])
    console.log("RegExp: " + i + ": " + re)
    break
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
            gas: 6700000
        },
        coverage: {
            host: "localhost",
            network_id: "*",
            port: 8555,
            gas: 0xffffffffff,
            gasPrice: 0x01
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
            version: "0.4.25",
            docker: true,
            settings: {
                optimizer: {
                    enabled: true,
                    runs: 200
                }
            }
        }
    },
    mocha: mochaConfig
}
